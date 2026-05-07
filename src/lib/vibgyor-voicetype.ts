import "../../external_modules/vibgyor-voicetype.js";

export type VibgyorVoiceTranscriptData = {
  final: string;
  interim: string;
  combined: string;
};

export type VibgyorVoiceErrorData = {
  type:
    | "not-supported"
    | "no-speech"
    | "audio-capture"
    | "not-allowed"
    | "network"
    | "aborted"
    | "language-not-supported"
    | "service-not-allowed"
    | "start-error";
  message: string;
};

export type VibgyorVoiceTypeOptions = {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  maxAlternatives?: number;
  onTranscript?: (data: VibgyorVoiceTranscriptData) => void;
  onInterim?: (data: { transcript: string; isFinal: boolean }) => void;
  onError?: (error: VibgyorVoiceErrorData) => void;
  onStart?: () => void;
  onEnd?: (data: { transcript: string }) => void;
  onAudioData?: (audioData: {
    frequencyData: number[];
    timeDomainData: number[];
    volume: number;
    bufferLength: number;
  }) => void;
  visualizationSampleRate?: number;
};

export type VibgyorVoiceTypeInstance = {
  start: () => Promise<void>;
  stop: () => void;
  abort: () => void;
  isActive: () => boolean;
  getTranscript: () => string;
  setLanguage: (language: string) => void;
};

type VibgyorVoiceTypeConstructor = {
  new (options?: VibgyorVoiceTypeOptions): VibgyorVoiceTypeInstance;
  isSupported: () => boolean;
};

export function getVibgyorVoiceType() {
  return (window as Window & { VibgyorVoiceType?: VibgyorVoiceTypeConstructor }).VibgyorVoiceType;
}
