import { ClientRequest } from 'http'
import { RequestOptions } from 'https'
import { StatusBarItem, WebviewView, commands, window, workspace } from 'vscode'

import { CONTEXT_NAME, MESSAGE_NAME, TABS, USER_NAME } from './constants'
import {
  StreamResponse,
  StreamOptions,
  ServerMessage,
  MessageType,
  TemplateData,
  ChatTemplateData,
  MessageRoleContent
} from './types'
import { getLanguage, streamResponse } from './utils'
import { CodeLanguageDetails } from './languages'
import { TemplateProvider } from './template-provider'

export class ChatService {
  private _config = workspace.getConfiguration('twinny')
  private _apiUrl = this._config.get('apiUrl') as string
  private _bearerToken = this._config.get('apiBearerToken') as string
  private _chatModel = this._config.get('chatModelName') as string
  private _completion = ''
  private _numPredictChat = this._config.get('numPredictChat') as number
  private _port = this._config.get('chatApiPort') as string
  private _apiPath = this._config.get('chatApiPath') as string
  private _temperature = this._config.get('temperature') as number
  private _useOpenAiApiFormat = this._config.get(
    'useOpenAiApiFormat'
  ) as boolean
  private _view?: WebviewView
  private _statusBar: StatusBarItem
  private _promptTemplate = ''
  private _currentRequest?: ClientRequest
  private _templateProvider?: TemplateProvider

  constructor(
    statusBar: StatusBarItem,
    templateDir: string,
    view?: WebviewView
  ) {
    this._view = view
    this._statusBar = statusBar

    this._templateProvider = new TemplateProvider(templateDir)
    workspace.onDidChangeConfiguration((event) => {
      if (!event.affectsConfiguration('twinny')) {
        return
      }
      this.updateConfig()
    })
  }

  private buildStreamRequest(
    prompt: string,
    messages?: MessageType[] | MessageRoleContent[]
  ) {
    const headers: Record<string, string> = {}

    if (this._bearerToken) {
      headers.Authorization = `Bearer ${this._bearerToken}`
    }

    const requestBody: StreamOptions = {
      model: this._chatModel,
      prompt,
      messages,
      stream: true,
      n_predict: this._numPredictChat,
      max_tokens: this._numPredictChat,
      temperature: this._temperature,
      // Ollama
      options: {
        temperature: this._temperature,
        num_predict: this._numPredictChat
      }
    }

    const requestOptions: RequestOptions = {
      hostname: this._apiUrl,
      port: this._port,
      path: this._apiPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this._bearerToken}`
      }
    }

    return { requestOptions, requestBody }
  }

  private onStreamData = (
    streamResponse: StreamResponse | undefined,
    onDestroy: () => void
  ) => {
    try {
      let data =
        streamResponse?.response || // llama.cpp
        streamResponse?.content // ollama

      if (!data && streamResponse?.choices?.length) {
        data = streamResponse.choices[0].delta.content
      } // lm studio / OpenAI)

      if (!data) {
        return
      }

      this._completion = this._completion + data

      this._view?.webview.postMessage({
        type: MESSAGE_NAME.twinnyOnCompletion,
        value: {
          completion: this._completion.trimStart(),
          data: getLanguage(),
          type: this._promptTemplate
        }
      } as ServerMessage)
      if (data?.match('<EOT>')) {
        onDestroy()
      }
    } catch (error) {
      console.error('Error parsing JSON:', error)
      return
    }
  }

  private onStreamEnd = () => {
    this._statusBar.text = '🤖'
    commands.executeCommand(
      'setContext',
      CONTEXT_NAME.twinnyGeneratingText,
      false
    )
    this._view?.webview.postMessage({
      type: MESSAGE_NAME.twinnyOnEnd,
      value: {
        completion: this._completion.trimStart(),
        data: getLanguage(),
        type: this._promptTemplate
      }
    } as ServerMessage)
  }

  private onStreamError = (error: Error) => {
    this._view?.webview.postMessage({
      type: MESSAGE_NAME.twinnyOnEnd,
      value: {
        error: true,
        errorMessage: error.message
      }
    } as ServerMessage)
  }

  private onStreamStart = (req: ClientRequest) => {
    this._statusBar.text = '$(loading~spin)'
    this._currentRequest = req
    commands.executeCommand(
      'setContext',
      CONTEXT_NAME.twinnyGeneratingText,
      true
    )
    this._view?.webview.onDidReceiveMessage((data: { type: string }) => {
      if (data.type === MESSAGE_NAME.twinnyStopGeneration) {
        req.destroy()
      }
    })
  }

  public destroyStream = () => {
    this._currentRequest?.destroy()
    this._statusBar.text = '🤖'
    commands.executeCommand(
      'setContext',
      CONTEXT_NAME.twinnyGeneratingText,
      true
    )
    this._view?.webview.postMessage({
      type: MESSAGE_NAME.twinnyOnEnd,
      value: {
        completion: this._completion.trimStart(),
        data: getLanguage(),
        type: this._promptTemplate
      }
    } as ServerMessage)
  }

  public buildMesageRoleContent = async (
    messages: MessageType[],
    language: CodeLanguageDetails
  ): Promise<MessageRoleContent[]> => {
    const editor = window.activeTextEditor
    const selection = editor?.selection
    const selectionContext = editor?.document.getText(selection) || ''
    const systemMessage = {
      role: 'system',
      content: await this._templateProvider?.readSystemMessageTemplate()
    }

    if (messages.length > 0 && (language || selectionContext)) {
      const lastMessage = messages[messages.length - 1]

      const detailsToAppend = []

      if (language.langName) {
        detailsToAppend.push(`Language: ${language.langName}`)
      }

      if (selectionContext) {
        detailsToAppend.push(`Selection: ${selectionContext}`)
      }

      const detailsString =
        detailsToAppend.length ? `\n\n${detailsToAppend.join('; ')}` : ''

      const updatedLastMessage = {
        ...lastMessage,
        content: `${lastMessage.content}${detailsString}`
      }

      messages.splice(messages.length - 1, 1, updatedLastMessage)
    }

    return [systemMessage, ...messages]
  }

  public buildChatMessagePrompt = async (
    messages: MessageType[],
    language: CodeLanguageDetails
  ) => {
    const editor = window.activeTextEditor
    const selection = editor?.selection
    const selectionContext = editor?.document.getText(selection) || ''
    const prompt =
      await this._templateProvider?.renderTemplate<ChatTemplateData>('chat', {
        code: selectionContext || '',
        messages,
        role: USER_NAME,
        language: language?.langName || 'unknown'
      })
    return prompt || ''
  }

  public buildTemplatePrompt = async (
    template: string,
    language: CodeLanguageDetails
  ) => {
    const editor = window.activeTextEditor
    const selection = editor?.selection
    const selectionContext = editor?.document.getText(selection) || ''
    const prompt = await this._templateProvider?.renderTemplate<TemplateData>(
      template,
      {
        code: selectionContext || '',
        language: language?.langName || 'unknown'
      }
    )
    return prompt || ''
  }

  private streamResponse({
    requestBody,
    requestOptions
  }: {
    requestBody: StreamOptions
    requestOptions: RequestOptions
  }) {
    this._view?.webview.postMessage({
      type: MESSAGE_NAME.twinnyOnLoading
    })

    return streamResponse({
      body: requestBody,
      options: requestOptions,
      onData: this.onStreamData,
      onEnd: this.onStreamEnd,
      onStart: this.onStreamStart,
      onError: this.onStreamError
    })
  }

  private sendEditorLanguage = () => {
    this._view?.webview.postMessage({
      type: MESSAGE_NAME.twinnySendLanguage,
      value: {
        data: getLanguage()
      }
    } as ServerMessage)
  }

  public focusChatTab = () => {
    this._view?.webview.postMessage({
      type: MESSAGE_NAME.twinnySetTab,
      value: {
        data: TABS.chat
      }
    } as ServerMessage<string>)
  }

  public async streamChatCompletion(messages: MessageType[]) {
    const { language } = getLanguage()
    this._completion = ''
    this.sendEditorLanguage()
    const messageRoleContent = await this.buildMesageRoleContent(
      messages,
      language
    )
    const prompt = await this.buildChatMessagePrompt(messages, language)
    const { requestBody, requestOptions } = this.buildStreamRequest(
      prompt,
      messageRoleContent
    )
    return this.streamResponse({ requestBody, requestOptions })
  }

  public async streamTemplateCompletion(promptTemplate: string) {
    const { language } = getLanguage()
    this._completion = ''
    this._promptTemplate = promptTemplate
    this.sendEditorLanguage()
    this.focusChatTab()
    const prompt = await this.buildTemplatePrompt(promptTemplate, language)
    const { requestBody, requestOptions } = this.buildStreamRequest(prompt)
    return this.streamResponse({ requestBody, requestOptions })
  }

  public updateConfig() {
    this._config = workspace.getConfiguration('twinny')
    this._temperature = this._config.get('temperature') as number
    this._chatModel = this._config.get('chatModelName') as string
    this._apiPath = this._config.get('chatApiPath') as string
    this._port = this._config.get('chatApiPort') as string
    this._apiUrl = this._config.get('apiUrl') as string
  }
}
