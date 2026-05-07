/**
 * Vibgyor Voice Type Plugin
 * A browser-based voice typing plugin with waveform visualization
 * Version: 1.0.0
 * License: MIT
 */

class VibgyorVoiceType {
  constructor(options = {}) {
    this.options = {
      language: options.language || 'en-US',
      continuous: options.continuous !== false, // Default true
      interimResults: options.interimResults !== false, // Default true
      maxAlternatives: options.maxAlternatives || 1,
      onTranscript: options.onTranscript || (() => {}),
      onInterim: options.onInterim || (() => {}),
      onError: options.onError || (() => {}),
      onStart: options.onStart || (() => {}),
      onEnd: options.onEnd || (() => {}),
      onAudioData: options.onAudioData || (() => {}), // For waveform visualization
      visualizationSampleRate: options.visualizationSampleRate || 60, // FPS for visualization
    };

    this.isRecording = false;
    this.recognition = null;
    this.audioContext = null;
    this.analyser = null;
    this.microphone = null;
    this.animationId = null;
    this.finalTranscript = '';
    this.interimTranscript = '';

    this._initRecognition();
  }

  /**
   * Initialize the Web Speech API recognition
   * @private
   */
  _initRecognition() {
    // Check browser support
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    
    if (!SpeechRecognition) {
      console.error('Vibgyor Voice Type: Web Speech API is not supported in this browser.');
      this.options.onError({
        type: 'not-supported',
        message: 'Speech recognition is not supported in this browser. Please use Chrome, Edge, or Safari.'
      });
      return;
    }

    this.recognition = new SpeechRecognition();
    this.recognition.continuous = this.options.continuous;
    this.recognition.interimResults = this.options.interimResults;
    this.recognition.maxAlternatives = this.options.maxAlternatives;
    this.recognition.lang = this.options.language;

    // Event handlers
    this.recognition.onstart = () => {
      this.isRecording = true;
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.options.onStart();
    };

    this.recognition.onresult = (event) => {
      let interim = '';
      
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        
        if (event.results[i].isFinal) {
          this.finalTranscript += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      this.interimTranscript = interim;

      // Call interim callback
      if (interim) {
        this.options.onInterim({
          transcript: interim,
          isFinal: false
        });
      }

      // Call transcript callback with both final and interim
      this.options.onTranscript({
        final: this.finalTranscript.trim(),
        interim: interim,
        combined: (this.finalTranscript + interim).trim()
      });
    };

    this.recognition.onerror = (event) => {
      this.options.onError({
        type: event.error,
        message: this._getErrorMessage(event.error)
      });
    };

    this.recognition.onend = () => {
      this.isRecording = false;
      this.options.onEnd({
        transcript: this.finalTranscript.trim()
      });

      // Stop audio visualization
      this._stopAudioVisualization();
    };
  }

  /**
   * Get user-friendly error messages
   * @private
   */
  _getErrorMessage(errorCode) {
    const messages = {
      'no-speech': 'No speech was detected. Please try again.',
      'audio-capture': 'No microphone was found or microphone access was denied.',
      'not-allowed': 'Microphone access was denied. Please allow microphone access.',
      'network': 'Network error occurred. Please check your internet connection.',
      'aborted': 'Speech recognition was aborted.',
      'language-not-supported': 'The specified language is not supported.',
      'service-not-allowed': 'Speech recognition service is not allowed.'
    };

    return messages[errorCode] || `An error occurred: ${errorCode}`;
  }

  /**
   * Initialize audio visualization
   * @private
   */
  async _initAudioVisualization() {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // Create audio context and analyser
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0.8;

      // Connect microphone to analyser
      this.microphone = this.audioContext.createMediaStreamSource(stream);
      this.microphone.connect(this.analyser);

      // Start visualization loop
      this._visualize();
    } catch (error) {
      console.error('Vibgyor Voice Type: Error accessing microphone for visualization:', error);
      this.options.onError({
        type: 'audio-capture',
        message: 'Could not access microphone for visualization.'
      });
    }
  }

  /**
   * Visualization loop for audio waveform
   * @private
   */
  _visualize() {
    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDomainArray = new Uint8Array(bufferLength);

    const draw = () => {
      if (!this.isRecording) return;

      this.animationId = requestAnimationFrame(draw);

      // Get frequency data
      this.analyser.getByteFrequencyData(dataArray);
      // Get time domain data (waveform)
      this.analyser.getByteTimeDomainData(timeDomainArray);

      // Calculate average volume
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;

      // Send audio data to callback
      this.options.onAudioData({
        frequencyData: Array.from(dataArray),
        timeDomainData: Array.from(timeDomainArray),
        volume: average,
        bufferLength: bufferLength
      });
    };

    draw();
  }

  /**
   * Stop audio visualization
   * @private
   */
  _stopAudioVisualization() {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId);
      this.animationId = null;
    }

    if (this.microphone) {
      this.microphone.disconnect();
      this.microphone = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }

    this.analyser = null;
  }

  /**
   * Start voice recording and transcription
   * @public
   */
  async start() {
    if (!this.recognition) {
      this.options.onError({
        type: 'not-supported',
        message: 'Speech recognition is not supported.'
      });
      return;
    }

    if (this.isRecording) {
      console.warn('Vibgyor Voice Type: Already recording.');
      return;
    }

    try {
      // Start audio visualization
      await this._initAudioVisualization();
      
      // Start speech recognition
      this.recognition.start();
    } catch (error) {
      console.error('Vibgyor Voice Type: Error starting recognition:', error);
      this.options.onError({
        type: 'start-error',
        message: 'Failed to start voice recognition.'
      });
    }
  }

  /**
   * Stop voice recording
   * @public
   */
  stop() {
    if (!this.isRecording) {
      console.warn('Vibgyor Voice Type: Not currently recording.');
      return;
    }

    if (this.recognition) {
      this.recognition.stop();
    }
  }

  /**
   * Abort voice recording
   * @public
   */
  abort() {
    if (this.recognition) {
      this.recognition.abort();
    }
    this._stopAudioVisualization();
  }

  /**
   * Check if currently recording
   * @public
   * @returns {boolean}
   */
  isActive() {
    return this.isRecording;
  }

  /**
   * Get the final transcript
   * @public
   * @returns {string}
   */
  getTranscript() {
    return this.finalTranscript.trim();
  }

  /**
   * Set the language for recognition
   * @public
   * @param {string} language - BCP-47 language tag (e.g., 'en-US', 'es-ES')
   */
  setLanguage(language) {
    this.options.language = language;
    if (this.recognition) {
      this.recognition.lang = language;
    }
  }

  /**
   * Get supported languages (common ones)
   * @public
   * @returns {Array}
   */
  static getSupportedLanguages() {
    return [
      { code: 'en-US', name: 'English (United States)' },
      { code: 'en-GB', name: 'English (United Kingdom)' },
      { code: 'es-ES', name: 'Spanish (Spain)' },
      { code: 'es-MX', name: 'Spanish (Mexico)' },
      { code: 'fr-FR', name: 'French' },
      { code: 'de-DE', name: 'German' },
      { code: 'it-IT', name: 'Italian' },
      { code: 'pt-BR', name: 'Portuguese (Brazil)' },
      { code: 'pt-PT', name: 'Portuguese (Portugal)' },
      { code: 'ru-RU', name: 'Russian' },
      { code: 'zh-CN', name: 'Chinese (Simplified)' },
      { code: 'zh-TW', name: 'Chinese (Traditional)' },
      { code: 'ja-JP', name: 'Japanese' },
      { code: 'ko-KR', name: 'Korean' },
      { code: 'ar-SA', name: 'Arabic' },
      { code: 'hi-IN', name: 'Hindi' },
    ];
  }

  /**
   * Check if speech recognition is supported
   * @public
   * @static
   * @returns {boolean}
   */
  static isSupported() {
    return !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  }
}

// Export for different module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = VibgyorVoiceType;
}

if (typeof window !== 'undefined') {
  window.VibgyorVoiceType = VibgyorVoiceType;
}
