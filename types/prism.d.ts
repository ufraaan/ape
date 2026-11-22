declare module 'prismjs' {
  const Prism: {
    readonly languages: Record<string, unknown>
    highlight(code: string, grammar: unknown, language?: string): string
  }

  export default Prism
}

declare module 'prismjs/components/*'
