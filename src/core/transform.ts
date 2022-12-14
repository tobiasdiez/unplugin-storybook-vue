import type { SFCDescriptor, SFCScriptBlock } from 'vue/compiler-sfc'
import {
  compileScript,
  compileTemplate,
  parse,
  rewriteDefault,
} from 'vue/compiler-sfc'
import type { ElementNode } from '@vue/compiler-core'
import { format as prettierFormat } from 'prettier'

/**
 * Transforms a vue single-file-component into Storybook's Component Story Format (CSF).
 */
export function transform(code: string) {
  const { descriptor } = parse(code)
  if (descriptor.template === null) throw new Error('No template found in SFC')

  let result = ''
  const resolvedScript = resolveScript(descriptor)
  if (resolvedScript) {
    result += rewriteDefault(resolvedScript.content, '_sfc_main')
    result += '\n'
  } else {
    result += 'const _sfc_main = {}\n'
  }
  result += transformTemplate(descriptor.template.content, resolvedScript)
  result = organizeImports(result)
  return result

  /*
  return `
    import MyButton from './Button.vue';
    import { userEvent, within } from '@storybook/testing-library';
    import { expect } from '@storybook/jest';

    export default {
      title: 'Example/ButtonTest',
      component: MyButton,
      argTypes: {
        backgroundColor: { control: 'color' },
        size: {
          control: { type: 'select', options: ['small', 'medium', 'large'] },
        },
        onClick: {},
      },
    };

    const Template = (args) => ({
      components: { MyButton },
      setup() {
        return { args };
      },
      template: '<my-button v-bind="args" />',
    });

    export const Primary = Template.bind({});
    Primary.args = {
      primary: true,
      label: 'Button',
    };
    Primary.play = async ({ args, canvasElement }) => {
      const canvas = within(canvasElement);
      const button = canvas.getByRole('button');
      await userEvent.click(button);
      await expect(args.onClick).toHaveBeenCalled();
    };

    export const Secondary = Template.bind({});
    Secondary.args = {
      label: 'Button',
    };

    export const Large = Template.bind({});
    Large.args = {
      size: 'large',
      label: 'Button',
    };

    export const Small = Template.bind({});
    Small.args = {
      size: 'small',
      label: 'Button',
    };
    `
    */
}

function transformTemplate(content: string, resolvedScript?: SFCScriptBlock) {
  const template = compileTemplate({
    source: content,
    filename: 'test.vue',
    id: 'test',
    /* compilerOptions: {
      nodeTransforms: [extractTitle, replaceStoryNode],
    }, */
  })

  const roots =
    template.ast?.children.filter(
      (node) => node.type === 1 /* NodeTypes.ELEMENT */
    ) ?? []
  if (roots.length !== 1) {
    throw new Error('Expected exactly one <Stories> element as root.')
  }

  const root = roots[0]
  if (root.type !== 1 || root.tag !== 'Stories')
    throw new Error('Expected root to be a <Stories> element.')

  let result = generateDefaultImport(root)
  for (const story of root.children ?? []) {
    if (story.type !== 1 || story.tag !== 'Story') continue

    result += generateStoryImport(story, resolvedScript)
  }
  return result
}

function generateDefaultImport(root: ElementNode) {
  const title = extractTitle(root)
  const component = extractComponent(root)
  return `export default {
    ${title ? `title: '${title}',` : ''}
    ${component ? `component: ${component},` : ''}
    //decorators: [ ... ],
    //parameters: { ... }
    }
    `
}

function extractProp(node: ElementNode, name: string) {
  if (node.type === 1) {
    return node.props.find(
      (prop) =>
        prop.name === name ||
        (prop.name === 'bind' &&
          prop.type === 7 &&
          prop.arg?.type === 4 &&
          prop.arg?.content === name)
    )
  }
}
function extractTitle(node: ElementNode) {
  const prop = extractProp(node, 'title')
  if (prop && prop.type === 6) return prop.value?.content
}

function extractComponent(node: ElementNode) {
  const prop = extractProp(node, 'component')
  if (prop && prop.type === 7)
    return prop.exp?.type === 4
      ? prop.exp?.content.replace('_ctx.', '')
      : undefined
}

function generateStoryImport(
  story: ElementNode,
  resolvedScript?: SFCScriptBlock
) {
  const title = extractTitle(story)
  if (!title) throw new Error('Story is missing a title')
  const cleanTitle = title.replace(/[^a-zA-Z0-9]/g, '_')
  const storyTemplate = parse(
    story.loc.source
      .replace(/<Story/, '<template')
      .replace(/<\/Story>/, '</template>')
  ).descriptor.template?.content
  if (storyTemplate === undefined) throw new Error('No template found in Story')

  const { code } = compileTemplate({
    source: storyTemplate.trim(),
    filename: 'test.vue',
    id: 'test',
    compilerOptions: { bindingMetadata: resolvedScript?.bindings },
  })
  const renderFunction = code.replace(
    'export function render',
    `function render${cleanTitle}`
  )

  // Each named export is a story, has to return a Vue ComponentOptionsBase
  return `
    ${renderFunction}
    export const ${cleanTitle} = () => Object.assign({render: render${cleanTitle}}, _sfc_main)
    ${cleanTitle}.storyName = '${title}'
    ${cleanTitle}.parameters = {
      docs: { source: { code: \`${storyTemplate.trim()}\` } },
    };`
}

// Minimal version of https://github.com/vitejs/vite/blob/57916a476924541dd7136065ceee37ae033ca78c/packages/plugin-vue/src/main.ts#L297
function resolveScript(descriptor: SFCDescriptor) {
  if (descriptor.script || descriptor.scriptSetup)
    return compileScript(descriptor, { id: 'test' })
}

function organizeImports(result: string): string {
  // Use prettier to organize imports
  return prettierFormat(result, {
    parser: 'babel',
    plugins: ['prettier-plugin-organize-imports'],
  })
}
