/** Type-only SDK. Bandal injects the implementation into activate(). */
export interface CommandContext {
  courseId: string
  relPath: string
}
export interface Selection extends CommandContext {
  token: string
  text: string
  from: number
  to: number
}
export interface Course {
  id: string
  name: string
  color: string
  archived: boolean
  groupId: string | null
}
export interface Note extends CommandContext {
  id: string
  title: string
  content: string
  mtime: number
}
export interface Bandal {
  commands: {
    register(
      id: string,
      handler: (context: CommandContext | null) => unknown | Promise<unknown>,
    ): void
  }
  courses: { list(): Promise<Course[]>; current(): Promise<Course | null> }
  notes: {
    list(
      courseId: string,
    ): Promise<
      Array<Omit<Note, 'content' | 'mtime'> & { mtime: number | null }>
    >
    read(noteId: string): Promise<Note>
    write(
      noteId: string,
      input: { content: string; expectedMtime?: number },
    ): Promise<unknown>
    create(
      courseId: string,
      input: { title: string; content?: string; dirRelPath?: string },
    ): Promise<unknown>
  }
  materials: {
    list(courseId: string): Promise<unknown[]>
    readText(courseId: string, relativePath: string): Promise<string>
  }
  settings: {
    get<T = unknown>(key: string): Promise<T | null>
    set(key: string, value: unknown): Promise<void>
  }
  editor: {
    getSelection(): Promise<Selection | null>
    replaceSelection(token: string, text: string): Promise<void>
  }
  panel: {
    open(id: string): Promise<void>
    close(id: string): Promise<void>
    post(id: string, payload: unknown): Promise<void>
    onMessage(id: string, handler: (payload: unknown) => unknown): () => void
  }
  events: {
    on(
      name: 'note:saved' | 'course:changed' | 'settings:changed',
      handler: (payload: unknown) => unknown,
    ): () => void
  }
  notices: { show(message: string, tone?: 'info' | 'danger'): Promise<void> }
  fetch(
    url: string,
    options?: {
      method?: string
      headers?: Record<string, string>
      body?: string
    },
  ): Promise<unknown>
}
export interface BandalPlugin {
  activate(bandal: Bandal): void | Promise<void>
  deactivate?(): void | Promise<void>
}
