import Button from '../components/Button.vue'

import type { Meta } from '@storybook/vue3'

export default {
  /* 👇 The title prop is optional.
   * See https://storybook.js.org/docs/vue/configure/overview#configure-story-loading
   * to learn how to generate automatic titles
   */
  title: 'docs/1. Default export/classical',
  component: Button,
} as Meta<typeof Button>
