import type { ResolvedLibrary, Version } from '@xmcl/core'
import type { InstallProfile, LiteloaderVersion, MinecraftVersion, QuiltArtifactVersion, InstallLabyModOptions as IInstallLabyModOptions, LabyModManifest } from '@xmcl/installer'
import { ForgeVersion, OptifineVersion, FabricVersions, LiteloaderVersions, MinecraftVersions, NeoForgedVersions } from '../entities/version'
import { ServiceKey } from './Service'
import { Resource } from '../entities/resource'

export interface InstallOptifineOptions extends OptifineVersion {
  /**
   * Install over forge
   */
  forgeVersion?: string
  inheritFrom?: string
}

export interface InstallQuiltOptions {
  /**
   * Quilt version
   */
  version: string

  minecraftVersion: string
}

export interface RefreshForgeOptions {
  force?: boolean
  mcversion: string
}

export interface Asset {
  name: string
  size: number
  hash: string
}

export interface InstallForgeOptions {
  /**
   * The installer info.
   *
   * If this is not presented, it will generate from mc version and forge version.
   */
  installer?: {
    sha1?: string
    /**
     * The url path to concat with forge maven
     */
    path: string
  }
  /**
   * The minecraft version
   */
  mcversion: string
  /**
   * The forge version (without minecraft version)
   */
  version: string
}

export interface InstallNeoForgedOptions {
  /**
   * The minecraft version
   */
  minecraft: string
  /**
   * The forge version (without minecraft version)
   */
  version: string
}

export interface InstallFabricOptions {
  /**
   * Forcing fabric yarn version
   */
  yarn?: string
  /**
   * The fabric loader version to install
   */
  loader: string
  /**
   * The minecraft version to install
   */
  minecraft: string
}

export type InstallableLibrary = Version.Library | ResolvedLibrary

export interface GetQuiltVersionListOptions {
  minecraftVersion?: string
  force?: boolean
}

export interface InstallLabyModOptions {
  manifest: LabyModManifest
  minecraftVersion: string
  environment?: string
}

/**
 * Version install service provide some functions to install Minecraft/Forge/Liteloader, etc. version
 */
export interface InstallService {
  /**
   * Install assets which defined in this version asset.json. If this version is not present, this will throw error！
   * @param version The local version id
   */
  installAssetsForVersion(version: string): Promise<void>
  installDependencies(version: string): Promise<void>
  /**
   * Install labymod to a minecraft version
   * @param options The install option
   */
  installLabyModVersion(options: InstallLabyModOptions): Promise<string>
  /**
   * If you think a version is corrupted, you can try to reinstall this version
   * @param version The version to reinstall
   */
  reinstall(version: string): Promise<void>
  /**
   * Install assets to the version
   * @param version The local version id
   */
  installAssets(assets: Asset[], version?: string, force?: boolean): Promise<void>
  /**
   * Download and install a minecraft version
   */
  installMinecraft(meta: MinecraftVersion): Promise<void>
  /**
   * Install provided libraries to game.
   */
  installLibraries(libraries: InstallableLibrary[], version?: string, force?: boolean): Promise<void>
  /**
   * Install neoForged to the minecraft
   */
  installNeoForged(options: InstallNeoForgedOptions): Promise<string | undefined>
  /**
   * Install forge by forge version metadata and minecraft
   */
  installForge(options: InstallForgeOptions): Promise<string | undefined>
  /**
   * Install fabric to the minecraft
   * @param options Install options for fabric
   */
  installFabric(options: InstallFabricOptions): Promise<string | undefined>
  /**
   * Install the optifine to the minecraft
   */
  installOptifine(options: InstallOptifineOptions): Promise<[string, Resource]>
  /**
   * Install the optifine uniersal jar as a resource
   */
  installOptifineAsResource(options: InstallOptifineOptions): Promise<Resource>
  /**
   * Install a specific liteloader version
   */
  installLiteloader(meta: LiteloaderVersion): Promise<void>

  installQuilt(meta: InstallQuiltOptions): Promise<string>

  installByProfile(profile: InstallProfile): Promise<void>
}

export const InstallServiceKey: ServiceKey<InstallService> = 'InstallService'
