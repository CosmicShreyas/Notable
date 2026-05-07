/**
 * Vibgyor Voice Type - TypeScript Declarations
 */

export interface TranscriptData {
  /** Finalized transcript text */
  final: string;
  /** Interim transcript text (not yet finalized) */
  interim: string;
  /** Combined final and interim text */
  combined: string;
}

export interface InterimData {
  /** The interim transcript text */
  transcript: string;
  /** Always false for interim results */
  isFinal: boolean;
}

export interface AudioData {
  /** Frequency domain data array (0-255) */
  frequencyData: number[];
  /** Time domain data array for waveform (0-255) */
  timeDomainData: number[];
  /** Average volume level (0-255) */
  volume: number;
  /** Size of the audio buffer */
  bufferLength: number;
}

export interface ErrorData {
  /** Error type identifier */
  type: 'not-supported' | 'no-speech' | 'audio-capture' | 'not-allowed' | 
        'network' | 'aborted' | 'language-not-supported' | 'service-not-allowed' | 
        'start-error';
  /** Human-readable error message */
  message: string;
}

export interface EndData {
  /** Final transcript when recording ends */
  transcript: string;
}

export interface VoiceTypeOptions {
  /** BCP-47 language code (e.g., 'en-US', 'es-ES') */
  language?: string;
  /** Whether to keep listening after pauses (default: true) */
  continuous?: boolean;
  /** Whether to return interim results (default: true) */
  interimResults?: boolean;
  /** Maximum number of alternative transcripts (default: 1) */
  maxAlternatives?: number;
  /** Callback when transcript is updated */
  onTranscript?: (data: TranscriptData) => void;
  /** Callback for interim results only */
  onInterim?: (data: InterimData) => void;
  /** Callback when an error occurs */
  onError?: (error: ErrorData) => void;
  /** Callback when recording starts */
  onStart?: () => void;
  /** Callback when recording ends */
  onEnd?: (data: EndData) => void;
  /** Callback with audio data for visualization */
  onAudioData?: (audioData: AudioData) => void;
  /** Sample rate for visualization updates (default: 60 FPS) */
  visualizationSampleRate?: number;
}

export interface LanguageInfo {
  /** BCP-47 language code */
  code: string;
  /** Human-readable language name */
  name: string;
}

/**
 * Vibgyor Voice Type - Browser-based voice typing plugin
 */
export default class VibgyorVoiceType {
  /**
   * Create a new VibgyorVoiceType instance
   * @param options Configuration options
   */
  constructor(options?: VoiceTypeOptions);

  /**
   * Start voice recording and transcription
   * @returns Promise that resolves when recording starts
   */
  start(): Promise<void>;

  /**
   * Stop voice recording gracefully
   */
  stop(): void;

  /**
   * Abort voice recording immediately
   */
  abort(): void;

  /**
   * Check if currently recording
   * @returns True if recording is active
   */
  isActive(): boolean;

  /**
   * Get the final transcript
   * @returns The finalized transcript text
   */
  getTranscript(): string;

  /**
   * Set the language for recognition
   * @param language BCP-47 language code
   */
  setLanguage(language: string): void;

  /**
   * Check if speech recognition is supported in the browser
   * @returns True if supported
   */
  static isSupported(): boolean;

  /**
   * Get a list of common supported languages
   * @returns Array of language objects
   */
  static getSupportedLanguages(): LanguageInfo[];
}

// Global type declaration for browsers
declare global {
  interface Window {
    VibgyorVoiceType: typeof VibgyorVoiceType;
  }
}
