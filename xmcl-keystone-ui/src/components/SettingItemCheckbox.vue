<template>
  <v-list-item @click="emit('input', !value)">
    <v-list-item-action class="self-center">
      <v-checkbox
        v-model="model"
        hide-details
        @click.stop
      />
    </v-list-item-action>
    <v-list-item-content>
      <v-list-item-title>
        {{ title }}
      </v-list-item-title>
      <v-list-item-subtitle v-if="description">
        {{ description }}
      </v-list-item-subtitle>
    </v-list-item-content>
  </v-list-item>
</template>
<script setup lang="ts">
import { useVModel } from '@vueuse/core'

const props = defineProps<{
  value: boolean
  title: string
  description?: string
}>()
const emit = defineEmits<{
  (event: 'input', value: boolean): void
}>()

const model = useVModel(props, 'value', emit)
</script>
