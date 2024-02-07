import { Position } from 'vscode'
import { CodeLanguageDetails } from './languages'
import { allBrackets } from './constants'

export interface StreamOptions {
  model: string
  prompt: string
  stream: boolean
  n_predict?: number
  max_tokens: number,
  temperature?: number
  messages?: MessageType[] | MessageRoleContent,
  options: Record<string, unknown> // Ollama
}

export interface StreamOptionsMessages {
  stream: boolean
  max_tokens: number
  temperature?: number
  prompt: string
}

export interface InlineCompletion {
  completion: string
  position: Position
  prefix: string
  suffix: string
  stop: string[]
}

export interface StreamResponse {
  model: string
  created_at: string
  response: string
  content: string
  done: boolean
  context: number[]
  total_duration: number
  load_duration: number
  prompt_eval_count: number
  prompt_eval_duration: number
  eval_count: number
  eval_duration: number
  choices: [{
    text: string,
    delta: {
      content: string
    }
  }],
}

export interface LanguageType {
  language: CodeLanguageDetails
  languageId: string | undefined
}

export interface ClientMessage<T = string | boolean | MessageType[]> {
  data?: T
  type?: string
  key?: string
}

export interface ServerMessage<T = LanguageType> {
  type: string
  value: {
    completion: string
    data?: T
    error?: boolean
    errorMessage?: string
    type: string
  }
}
export interface MessageType {
  role: string
  content: string | undefined
  type?: string
  language?: LanguageType
  error?: boolean
}

export type MessageRoleContent = Pick<MessageType, 'role' | 'content'>

export const Theme = {
  Light: 'Light',
  Dark: 'Dark',
  Contrast: 'Contrast'
} as const

export interface DefaultTemplate {
  systemMessage?: string
}

export interface TemplateData extends Record<string, string | undefined> {
  systemMessage?: string
  code: string
  language: string
}

export interface ChatTemplateData {
  systemMessage?: string
  role: string
  messages: MessageType[]
  code: string
  language: string
}

export type ThemeType = (typeof Theme)[keyof typeof Theme]

export interface PromptTemplate {
  context: string
  header: string
  suffix: string
  prefix: string
  useFileContext: boolean
}

export type Bracket = (typeof allBrackets)[number]

