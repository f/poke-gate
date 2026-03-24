import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(
  defineConfig({
    title: 'Poke Gate',
    description: 'Let your Poke AI assistant access your machine',
    head: [
      ['link', { rel: 'icon', href: '/logo.png' }],
    ],
    themeConfig: {
      logo: '/logo.png',
      nav: [
        { text: 'Guide', link: '/getting-started' },
        { text: 'Agents', link: '/agents/' },
        { text: 'CLI', link: '/cli' },
        {
          text: 'Download',
          items: [
            { text: 'macOS App', link: 'https://github.com/f/poke-gate/releases/latest' },
            { text: 'Homebrew', link: '/getting-started#homebrew' },
            { text: 'npm', link: 'https://www.npmjs.com/package/poke-gate' },
          ]
        }
      ],
      sidebar: [
        {
          text: 'Guide',
          items: [
            { text: 'Getting Started', link: '/getting-started' },
            { text: 'How It Works', link: '/how-it-works' },
            { text: 'Tools', link: '/tools' },
          ]
        },
        {
          text: 'Agents',
          items: [
            { text: 'Overview', link: '/agents/' },
            { text: 'Creating Agents', link: '/agents/creating' },
            { text: 'Installing Agents', link: '/agents/installing' },
            { text: 'Community Agents', link: '/agents/community' },
          { text: 'Beeper Example', link: '/agents/beeper' },
          { text: 'Sharing Agents', link: '/agents/sharing' },
          ]
        },
        {
          text: 'Reference',
          items: [
            { text: 'macOS App', link: '/macos-app' },
            { text: 'CLI Reference', link: '/cli' },
            { text: 'Security', link: '/security' },
          ]
        }
      ],
      socialLinks: [
        { icon: 'github', link: 'https://github.com/f/poke-gate' },
        { icon: 'npm', link: 'https://www.npmjs.com/package/poke-gate' },
      ],
      footer: {
        message: 'Community project — not affiliated with Poke or The Interaction Company.',
        copyright: 'Released under the MIT License.',
      },
      editLink: {
        pattern: 'https://github.com/f/poke-gate/edit/main/docs/:path',
        text: 'Edit this page on GitHub',
      },
    },
    mermaid: {
      theme: 'neutral',
      themeVariables: {
        fontSize: '13px',
      },
    },
  })
)
