import { kFlights } from '~/flights'
import { PeerService } from '~/peer'
import { ResourceService } from '~/resource'
import { UserService } from '~/user'
import { LaunchService as ILaunchService, InstanceModsState, PartialResourceHash, Resource, ResourceDomain, ResourceMetadata, getInstanceModStateKey } from '@xmcl/runtime-api'
import type { Contracts } from 'applicationinsights'
import { randomUUID } from 'crypto'
import { LauncherAppPlugin } from '~/app'
import { IS_DEV } from '../constant'
import { kClientToken, kIsNewClient } from '~/clientToken'
import { kSettings } from '~/settings'
import { APP_INSIGHT_KEY, parseStack } from './telemetry'
import { InstanceService } from '~/instance'
import { JavaService } from '~/java'
import { LaunchService } from '~/launch'
import { NatService } from '~/nat'
import { ServiceStateManager } from '~/service'

const getSdkVersion = () => {
  let sdkVersion = ''

  if (process.versions.electron) {
    sdkVersion += 'electron:' + process.versions.electron + ';'
  }
  if (process.versions.node) {
    sdkVersion += 'node:' + process.versions.node + ';'
  }
  if (process.versions.napi) {
    sdkVersion += 'napi:' + process.versions.napi + ';'
  }

  return sdkVersion
}

export const pluginTelemetry: LauncherAppPlugin = async (app) => {
  process.env.APPLICATIONINSIGHTS_CONFIGURATION_CONTENT = '{}'
  const logger = app.getLogger('Telemtry')
  const appInsight = await import('applicationinsights')
  const contract = new appInsight.Contracts.ContextTagKeys()

  const sessionId = randomUUID()

  const clientSession = await app.registry.get(kClientToken)
  const isNewClient = await app.registry.get(kIsNewClient)
  const flights = await app.registry.get(kFlights)
  const stateManager = await app.registry.get(ServiceStateManager)

  appInsight.setup(APP_INSIGHT_KEY)
    .setDistributedTracingMode(appInsight.DistributedTracingModes.AI_AND_W3C)
    .setAutoCollectExceptions(true)
    .setAutoCollectPerformance(true)
    .setAutoCollectConsole(false)
    .setAutoCollectDependencies(false)
    .setAutoCollectRequests(false)
    .start()

  const tags = appInsight.defaultClient.context.tags
  tags[contract.sessionId] = sessionId
  tags[contract.userId] = clientSession
  tags[contract.applicationVersion] = IS_DEV ? '0.0.0' : `${app.version}#${app.build}`
  tags[contract.operationParentId] = 'root'
  tags[contract.deviceModel] = app.platform.arch
  tags[contract.cloudRole] = app.env
  tags[contract.internalSdkVersion] = getSdkVersion()

  const createExceptionDetails = (msg?: string, name?: string, stack?: string) => {
    const d = new appInsight.Contracts.ExceptionDetails()
    d.message = msg?.substring(0, 32768) || ''
    d.typeName = name?.substring(0, 1024) || ''
    d.parsedStack = parseStack(stack) as any
    d.hasFullStack = (d.parsedStack instanceof Array) && d.parsedStack.length > 0
    return d
  }

  const handleException = (exception: Contracts.ExceptionData, e: Error) => {
    if (e.cause instanceof Error) {
      exception.exceptions.push(createExceptionDetails(e.cause.message, e.cause.name, e.cause.stack))
    } else if (e instanceof AggregateError || (Array.isArray((e as any).errors))) {
      for (const cause of (e as any).errors) {
        handleException(exception, cause)
      }
    }
  }

  const client = appInsight.defaultClient

  client.addTelemetryProcessor((envelope, contextObjects) => {
    if (contextObjects?.error) {
      const exception = envelope.data.baseData as Contracts.ExceptionData
      const e = contextObjects?.error
      if (e instanceof Error) {
        handleException(exception, e)
      }
    }
    return true
  })

  logger.log('Telemetry client started')
  client.trackEvent({
    name: 'app-start',
    properties: {
      isNewClient,
    },
  })

  app.registryDisposer(async () => {
    client.flush()
  })

  app.on('service-call-end', (serviceName, serviceMethod, duration, success) => {
    const shouldTrack = () => {
      if (serviceName === 'LaunchService' && serviceMethod === 'launch') return true
      if (serviceName === 'UserSerivce' && serviceMethod === 'refreshUser') return true
      return false
    }
    if (shouldTrack()) {
      client.trackRequest({
        name: `${serviceName}.${serviceMethod}`,
        url: `/${serviceName}/${serviceMethod}`,
        resultCode: success ? 200 : 500,
        duration,
        success,
      })
    }
  })

  app.on('engine-ready', async () => {
    const settings = await app.registry.get(kSettings)
    app.registry.getOrCreate(NatService).then(async (service) => {
      const state = await service.getNatState()
      if (state.natDevice) {
        client.trackEvent({
          name: 'nat-device',
          properties: {
            natDeviceSupported: !!state.natDevice,
          },
        })
      }
    }, (e) => {
      /* no-op */
    })

    let javaService: JavaService | undefined
    app.registry.get(JavaService).then(service => {
      javaService = service
    })
    let instanceService: InstanceService | undefined
    app.registry.get(InstanceService).then(service => {
      instanceService = service
    })

    // Track game start and end
    app.registry.get(LaunchService).then((service: LaunchService) => {
      (service as ILaunchService).on('minecraft-start', (options) => {
        if (settings.disableTelemetry) return
        client.trackEvent({
          name: 'minecraft-start',
          properties: options,
          tagOverrides: {
            [contract.operationId]: options.operationId ?? '',
          },
        })
      })
        .on('minecraft-exit', ({ code, signal, crashReport, operationId }) => {
          if (settings.disableTelemetry) return
          const normalExit = code === 0
          const crashed = crashReport && crashReport.length > 0
          if (normalExit) {
            client.trackEvent({
              name: 'minecraft-exit',
            })
          } else {
            client.trackEvent({
              name: 'minecraft-exit',
              properties: {
                code,
                signal,
                crashed,
              },
              tagOverrides: {
                [contract.operationId]: operationId ?? '',
              },
            })
          }
        }).on('launch-performance', ({ name, id, duration }) => {
          if (settings.disableTelemetry) return
          client.trackEvent({
            name,
            measurements: {
              duration,
            },
            tagOverrides: {
              [contract.operationId]: id,
              [contract.operationName]: name,
            },
          })
        }).on('launch-performance-pre', ({ name, id }) => {
          if (settings.disableTelemetry) return
          client.trackEvent({
            name: name + '-pre',
            tagOverrides: {
              [contract.operationId]: id,
              [contract.operationName]: name,
            },
          })
        })

      if (!flights.disableMinecraftRunLog) {
        service.registerMiddleware({
          name: 'minecraft-run-telemetry',
          async onBeforeLaunch(_, { gamePath }, ctx) {
            const state = stateManager.get<InstanceModsState>(getInstanceModStateKey(gamePath))
            const mods = state?.mods.map(m => {
              const payload = getPayload(m.hash, m.metadata, m.name, m.domain)
              delete payload.name
              delete payload.domain
              return payload
            })
            const runtime = instanceService?.state.all[gamePath]?.runtime
            if (mods) {
              ctx.mods = mods
              ctx.runtime = runtime
            }
          },
          async onAfterLaunch(result, opts, ctx) {
            if (result.code !== 0) {
              return
            }
            if (ctx.mods) {
              client.trackEvent({
                name: 'minecraft-run-record',
                properties: {
                  mods: ctx.mods,
                  runtime: ctx.runtime,
                  java: await javaService?.getJavaState().then((javaState) => {
                    const javaVersion = javaState.all.find(s => s.path === opts.javaPath)
                    if (javaVersion) {
                      return {
                        majorVersion: javaVersion.majorVersion,
                        version: javaVersion.version,
                      }
                    }
                  }),
                },
              })
            }
          },
        })
      }
    })

    process.on('uncaughtException', (e) => {
      if (settings.disableTelemetry) return
      if (client) {
        client.trackException({
          exception: e,
          properties: e ? { ...e } : undefined,
        })
      }
    })
    process.on('unhandledRejection', (e) => {
      if (settings.disableTelemetry) return
      if (client) {
        client.trackException({
          exception: e as any, // the applicationinsights will convert it to error automatically
          properties: e ? { ...e } : undefined,
        })
      }
    })
    app.logEmitter.on('failure', (destination, tag, e: Error) => {
      if (settings.disableTelemetry) return
      client.trackException({
        exception: e,
        properties: e ? { ...e } : undefined,
        contextObjects: {
          error: e,
        },
        tagOverrides: {
          [contract.operationParentId]: tag,
        },
      })
    })

    const getPayload = (sha1: string, metadata: ResourceMetadata, name?: string, domain?: ResourceDomain) => {
      interface ResourceTracingPayload {
        name?: string
        sha1: string
        domain?: ResourceDomain
        forge?: {
          modId: string
          version: string
        }
        fabric?: {
          modId: string
          version: string
        }[]
        curseforge?: {
          projectId: number
          fileId: number
        }
        modrinth?: {
          projectId: string
          versionId: string
        }
      }
      const trace: ResourceTracingPayload = {
        name,
        sha1,
        domain,
      }
      if (metadata.curseforge) {
        trace.curseforge = {
          projectId: metadata.curseforge.projectId,
          fileId: metadata.curseforge.fileId,
        }
      }
      if (metadata.modrinth) {
        trace.modrinth = {
          projectId: metadata.modrinth.projectId,
          versionId: metadata.modrinth.versionId,
        }
      }
      if (metadata.forge) {
        trace.forge = {
          modId: metadata.forge.modid,
          version: metadata.forge.version,
        }
      }
      if (metadata.fabric) {
        if (metadata.fabric instanceof Array) {
          trace.fabric = metadata.fabric.map(f => ({
            modId: f.id,
            version: f.version,
          }))
        } else {
          trace.fabric = [{
            modId: metadata.fabric.id,
            version: metadata.fabric.version,
          }]
        }
      }

      return trace
    }

    // Collect resource metadata
    app.registry.get(ResourceService).then((resourceService) => {
      resourceService.on('resourceAdd', (res: Resource) => {
        if (settings.disableTelemetry) return
        client.trackEvent({
          name: 'resource-metadata-v2',
          properties: getPayload(res.hash, res.metadata, res.name, res.domain),
        })
      })
      resourceService.on('resourceUpdate', (res: PartialResourceHash) => {
        if (settings.disableTelemetry) return
        if (res.metadata) {
          client.trackEvent({
            name: 'resource-metadata-v2',
            properties: getPayload(res.hash, res.metadata, res.name),
          })
        }
      })
    })

    // Track user authority
    app.registry.get(UserService).then(service => {
      service.on('user-login', (authority) => {
        if (settings.disableTelemetry) return
        client.trackEvent({
          name: 'user-login',
          properties: {
            authService: authority,
          },
        })
      })
    })

    // Track peer connection quality
    app.registry.get(PeerService).then(service => {
      service.getPeerState().then(state => {
        state.subscribe('connectionStateChange', (state) => {
          if (state.connectionState === 'connected') {
            client.trackEvent({
              name: 'peer-connection-connected',
            })
          }
        })
        state.subscribe('connectionAdd', (conn) => {
          client.trackEvent({
            name: 'peer-connection-add',
          })
        })
      })
    })
  })
}
