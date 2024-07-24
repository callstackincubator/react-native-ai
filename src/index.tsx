import { NativeEventEmitter, NativeModules, Platform } from 'react-native';
import {
  UnsupportedFunctionalityError,
  type LanguageModelV1,
  type LanguageModelV1CallOptions,
  type LanguageModelV1CallWarning,
  type LanguageModelV1FinishReason,
  type LanguageModelV1FunctionToolCall,
  type LanguageModelV1ImagePart,
  type LanguageModelV1Prompt,
  type LanguageModelV1StreamPart,
  type LanguageModelV1TextPart,
  type LanguageModelV1ToolCallPart,
  type LanguageModelV1ToolResultPart,
} from '@ai-sdk/provider';
import './polyfills';
import { ReadableStream } from 'web-streams-polyfill/ponyfill';

const LINKING_ERROR =
  `The package 'react-native-ai' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

// @ts-expect-error
const isTurboModuleEnabled = global.__turboModuleProxy != null;

const AiModule = isTurboModuleEnabled
  ? require('./NativeAi').default
  : NativeModules.Ai;

const Ai = AiModule
  ? AiModule
  : new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      }
    );

export default Ai;

export interface AiModelSettings extends Record<string, unknown> {}

export interface Model {
  modelId: string;
  modelLib: string;
}

function getStringContent(
  content:
    | string
    | (LanguageModelV1TextPart | LanguageModelV1ImagePart)[]
    | (LanguageModelV1TextPart | LanguageModelV1ToolCallPart)[]
    | LanguageModelV1ToolResultPart[]
): string {
  if (typeof content === 'string') {
    return content.trim();
  } else if (Array.isArray(content) && content.length > 0) {
    const [first] = content;
    if (first.type !== 'text') {
      throw new UnsupportedFunctionalityError({ functionality: 'toolCall' });
    }
    return first.text.trim();
  } else {
    return '';
  }
}

class AiModel implements LanguageModelV1 {
  readonly specificationVersion = 'v1';
  readonly defaultObjectGenerationMode = 'json';
  readonly provider = 'gemini-nano';
  public modelId: string;
  private options: AiModelSettings;

  constructor(modelId: string, options: AiModelSettings = {}) {
    this.modelId = modelId;
    this.options = options;

    console.debug('init:', this.modelId);
  }

  private model!: Model;
  async getModel() {
    this.model = await Ai.getModel(this.modelId);

    return this.model;
  }

  async doGenerate(options: LanguageModelV1CallOptions): Promise<{
    text?: string;
    toolCalls?: Array<LanguageModelV1FunctionToolCall>;
    finishReason: LanguageModelV1FinishReason;
    usage: {
      promptTokens: number;
      completionTokens: number;
    };
    rawCall: {
      rawPrompt: unknown;
      rawSettings: Record<string, unknown>;
    };
  }> {
    const model = await this.getModel();
    console.log({ model });

    // TODO: poprawna obsluga tego zeby typescript nie narzekal
    const message =
      options.prompt[options.prompt.length - 1]!.content[0]!.text!;
    console.log({ message });

    let text = '';

    if (message.trim().length > 0) {
      text = await Ai.doGenerate(model, message);
    }

    return {
      text,
      finishReason: 'stop',
      usage: {
        promptTokens: 0,
        completionTokens: 0,
      },
      rawCall: {
        rawPrompt: options,
        rawSettings: {},
      },
    };
  }

  stream = null;
  controller = null;
  streamId = null;

  public doStream = async (
    options: LanguageModelV1CallOptions
  ): Promise<{
    stream: ReadableStream<LanguageModelV1StreamPart>;
    rawCall: { rawPrompt: unknown; rawSettings: Record<string, unknown> };
    rawResponse?: { headers?: Record<string, string> };
    warnings?: LanguageModelV1CallWarning[];
  }> => {
    console.debug('stream options:', options);

    const model = await this.getModel();
    const message =
      options.prompt[options.prompt.length - 1]!.content[0]!.text!;

    const eventEmitter = new NativeEventEmitter(NativeModules.Ai);
    eventEmitter.addListener('onChatUpdate', (data) => {
      console.log({ data });
    });

    eventEmitter.addListener('onChatComplete', () => {
      console.log('onChatComplete');
    });

    // const stream = new ReadableStream({
    //   start: async (controller) => {
    //     this.controller = controller;

    //     try {
    //       this.streamId =
    //         await StreamingChatModule.streamChatCompletion(message);

    //       this.updateListener = eventEmitter.addListener(
    //         'chatUpdate',
    //         this.handleChatUpdate
    //       );
    //       this.completeListener = eventEmitter.addListener(
    //         'chatComplete',
    //         this.handleChatComplete
    //       );
    //       this.errorListener = eventEmitter.addListener(
    //         'chatError',
    //         this.handleChatError
    //       );
    //     } catch (error) {
    //       controller.error(error);
    //     }
    //   },
    //   cancel: () => {
    //     this.cleanup();
    //   },
    // });

    Ai.doStream(model.modelId, message);

    // const stream = new ReadableStream({
    //   start: (controller) => {
    //     this.controller = controller;

    //     this.chatCompleteListener = eventEmitter.addListener(
    //       'chatComplete',
    //       (data) => {
    //         console.log(data);
    //       }
    //     );
    //     this.chatErrorListener = eventEmitter.addListener(
    //       'chatError',
    //       (data) => {
    //         console.log(data);
    //       }
    //     );

    //     Ai.doStream(model, message); // this should be called via model.doStream()
    //   },
    //   cancel: () => {
    //     console.log('cancel');
    //     console.log('cleanup?');
    //     this.chatUpdateListener.remove();
    //     this.chatCompleteListener.remove();
    //     this.chatErrorListener.remove();
    //   },
    // });

    // const promptStream = session.promptStreaming(message);
    // const transformStream = new StreamAI(options.abortSignal);
    // const stream = promptStream.pipeThrough(transformStream);

    // TODO: how to convert event emitter to stream

    return {
      stream: [],
      rawCall: { rawPrompt: options.prompt, rawSettings: this.options },
    };
  };

  // Add other methods here as needed
}

type ModelOptions = {};

export function getModel(modelId: string, options: ModelOptions = {}): AiModel {
  return new AiModel(modelId, options);
}

const { doGenerate, doStream } = Ai;

export { doGenerate, doStream };
