# 🎙️ Vibgyor Voice Type

A fast, reliable, and accurate browser-based voice typing plugin with real-time waveform visualization.

## Features

- ✅ **Browser-Based**: No server required, works completely in the browser
- ✅ **Real-Time Transcription**: Instant speech-to-text conversion
- ✅ **Waveform Visualization**: Beautiful audio visualization while recording
- ✅ **Multi-Language Support**: Support for 15+ languages
- ✅ **Interim Results**: See transcription in real-time as you speak
- ✅ **Easy Integration**: Simple API, easy to integrate into any frontend
- ✅ **Lightweight**: No large ML models to download (uses Web Speech API)
- ✅ **Cross-Browser**: Works on Chrome, Edge, Safari, and other modern browsers

## Browser Support

Vibgyor Voice Type uses the Web Speech API, which is supported in:

- ✅ Google Chrome (Desktop & Mobile)
- ✅ Microsoft Edge
- ✅ Safari (Desktop & Mobile)
- ✅ Opera
- ❌ Firefox (not yet supported)

**Note**: The Web Speech API requires an internet connection for transcription.

## Quick Start

### 1. Include the Plugin

Add the script to your HTML:

```html
<script src="vibgyor-voicetype.js"></script>
```

### 2. Add a Microphone Button

Create an SVG button (or any element) to trigger recording:

```html
<button id="micButton">
    <svg width="40" height="40" viewBox="0 0 24 24">
        <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
        <path fill="currentColor" d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
    </svg>
</button>

<div id="transcript"></div>
<canvas id="waveform"></canvas>
```

### 3. Initialize the Plugin

```javascript
const voiceType = new VibgyorVoiceType({
    language: 'en-US',
    
    // Called when transcript is updated
    onTranscript: (data) => {
        console.log('Final:', data.final);
        console.log('Interim:', data.interim);
        console.log('Combined:', data.combined);
        
        // Update your UI
        document.getElementById('transcript').textContent = data.combined;
    },
    
    // Called when recording starts
    onStart: () => {
        console.log('Recording started');
    },
    
    // Called when recording ends
    onEnd: (data) => {
        console.log('Recording ended:', data.transcript);
    },
    
    // Called on errors
    onError: (error) => {
        console.error('Error:', error.message);
    },
    
    // Called with audio data for visualization
    onAudioData: (audioData) => {
        // Draw waveform using audioData
        drawWaveform(audioData);
    }
});

// Start recording
document.getElementById('micButton').addEventListener('click', () => {
    if (voiceType.isActive()) {
        voiceType.stop();
    } else {
        voiceType.start();
    }
});
```

## API Reference

### Constructor Options

```javascript
new VibgyorVoiceType({
    language: 'en-US',              // BCP-47 language code
    continuous: true,                // Keep listening after pauses
    interimResults: true,            // Return interim results
    maxAlternatives: 1,              // Number of alternative transcripts
    onTranscript: (data) => {},      // Transcript callback
    onInterim: (data) => {},         // Interim results callback
    onError: (error) => {},          // Error callback
    onStart: () => {},               // Start callback
    onEnd: (data) => {},             // End callback
    onAudioData: (data) => {},       // Audio data for visualization
    visualizationSampleRate: 60      // FPS for visualization
})
```

### Methods

#### `start()`
Start voice recording and transcription.

```javascript
voiceType.start();
```

#### `stop()`
Stop voice recording gracefully.

```javascript
voiceType.stop();
```

#### `abort()`
Abort voice recording immediately.

```javascript
voiceType.abort();
```

#### `isActive()`
Check if currently recording.

```javascript
if (voiceType.isActive()) {
    console.log('Currently recording');
}
```

#### `getTranscript()`
Get the final transcript.

```javascript
const text = voiceType.getTranscript();
```

#### `setLanguage(language)`
Change the recognition language.

```javascript
voiceType.setLanguage('es-ES');  // Switch to Spanish
```

### Static Methods

#### `VibgyorVoiceType.isSupported()`
Check if speech recognition is supported in the browser.

```javascript
if (VibgyorVoiceType.isSupported()) {
    // Initialize plugin
} else {
    alert('Speech recognition not supported');
}
```

#### `VibgyorVoiceType.getSupportedLanguages()`
Get a list of common supported languages.

```javascript
const languages = VibgyorVoiceType.getSupportedLanguages();
// Returns: [{ code: 'en-US', name: 'English (United States)' }, ...]
```

## Callbacks

### onTranscript(data)

Called whenever the transcript is updated.

```javascript
{
    final: "Hello world",           // Finalized text
    interim: "how are",             // Interim text (not yet final)
    combined: "Hello world how are" // Final + interim combined
}
```

### onInterim(data)

Called for interim results only.

```javascript
{
    transcript: "how are you",
    isFinal: false
}
```

### onAudioData(audioData)

Called continuously with audio data for visualization.

```javascript
{
    frequencyData: [12, 45, 78, ...],    // Frequency domain data
    timeDomainData: [128, 130, 126, ...], // Time domain data (waveform)
    volume: 67.5,                         // Average volume (0-255)
    bufferLength: 1024                    // Buffer size
}
```

### onError(error)

Called when an error occurs.

```javascript
{
    type: 'no-speech',                    // Error type
    message: 'No speech was detected.'    // Human-readable message
}
```

**Error Types:**
- `not-supported` - Browser doesn't support speech recognition
- `no-speech` - No speech detected
- `audio-capture` - Microphone access denied
- `not-allowed` - Permission denied
- `network` - Network error
- `aborted` - Recognition aborted

## Drawing Waveform Visualization

Here's a simple example of drawing the waveform:

```javascript
const canvas = document.getElementById('waveform');
const ctx = canvas.getContext('2d');

function drawWaveform(audioData) {
    const { timeDomainData, volume } = audioData;
    const width = canvas.width;
    const height = canvas.height;

    // Clear canvas
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, width, height);

    // Draw waveform
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#667eea';
    ctx.beginPath();

    const sliceWidth = width / timeDomainData.length;
    let x = 0;

    for (let i = 0; i < timeDomainData.length; i++) {
        const v = timeDomainData[i] / 128.0;
        const y = v * height / 2;

        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
        x += sliceWidth;
    }

    ctx.stroke();
}
```

## Supported Languages

The plugin supports 15+ languages out of the box:

- English (US, UK)
- Spanish (Spain, Mexico)
- French
- German
- Italian
- Portuguese (Brazil, Portugal)
- Russian
- Chinese (Simplified, Traditional)
- Japanese
- Korean
- Arabic
- Hindi

Use the BCP-47 language tags (e.g., `en-US`, `es-ES`, `fr-FR`).

## Integration Examples

### React

```jsx
import { useEffect, useRef, useState } from 'react';

function VoiceInput() {
    const [transcript, setTranscript] = useState('');
    const [isRecording, setIsRecording] = useState(false);
    const voiceTypeRef = useRef(null);

    useEffect(() => {
        voiceTypeRef.current = new VibgyorVoiceType({
            onTranscript: (data) => setTranscript(data.combined),
            onStart: () => setIsRecording(true),
            onEnd: () => setIsRecording(false)
        });

        return () => {
            if (voiceTypeRef.current?.isActive()) {
                voiceTypeRef.current.abort();
            }
        };
    }, []);

    const toggleRecording = () => {
        if (isRecording) {
            voiceTypeRef.current.stop();
        } else {
            voiceTypeRef.current.start();
        }
    };

    return (
        <div>
            <button onClick={toggleRecording}>
                {isRecording ? 'Stop' : 'Start'}
            </button>
            <p>{transcript}</p>
        </div>
    );
}
```

### Vue

```vue
<template>
    <div>
        <button @click="toggleRecording">
            {{ isRecording ? 'Stop' : 'Start' }}
        </button>
        <p>{{ transcript }}</p>
    </div>
</template>

<script>
export default {
    data() {
        return {
            transcript: '',
            isRecording: false,
            voiceType: null
        };
    },
    mounted() {
        this.voiceType = new VibgyorVoiceType({
            onTranscript: (data) => {
                this.transcript = data.combined;
            },
            onStart: () => {
                this.isRecording = true;
            },
            onEnd: () => {
                this.isRecording = false;
            }
        });
    },
    methods: {
        toggleRecording() {
            if (this.isRecording) {
                this.voiceType.stop();
            } else {
                this.voiceType.start();
            }
        }
    },
    beforeUnmount() {
        if (this.voiceType?.isActive()) {
            this.voiceType.abort();
        }
    }
};
</script>
```

### Angular

```typescript
import { Component, OnInit, OnDestroy } from '@angular/core';

@Component({
    selector: 'app-voice-input',
    template: `
        <button (click)="toggleRecording()">
            {{ isRecording ? 'Stop' : 'Start' }}
        </button>
        <p>{{ transcript }}</p>
    `
})
export class VoiceInputComponent implements OnInit, OnDestroy {
    transcript = '';
    isRecording = false;
    voiceType: any;

    ngOnInit() {
        this.voiceType = new (window as any).VibgyorVoiceType({
            onTranscript: (data: any) => {
                this.transcript = data.combined;
            },
            onStart: () => {
                this.isRecording = true;
            },
            onEnd: () => {
                this.isRecording = false;
            }
        });
    }

    toggleRecording() {
        if (this.isRecording) {
            this.voiceType.stop();
        } else {
            this.voiceType.start();
        }
    }

    ngOnDestroy() {
        if (this.voiceType?.isActive()) {
            this.voiceType.abort();
        }
    }
}
```

## Performance Tips

1. **Continuous Mode**: If you don't need continuous listening, set `continuous: false` to save resources.

2. **Interim Results**: Disable `interimResults: false` if you only need final transcripts.

3. **Visualization Rate**: Reduce `visualizationSampleRate` for lower CPU usage.

4. **Cleanup**: Always call `abort()` or `stop()` when unmounting components.

## Troubleshooting

### "Speech recognition is not supported"

- Make sure you're using a supported browser (Chrome, Edge, Safari)
- Check if you're on HTTPS (required for microphone access)
- Try updating your browser to the latest version

### "Microphone access was denied"

- Check browser permissions for microphone access
- Make sure no other app is using the microphone
- Try using HTTPS instead of HTTP

### "Network error occurred"

- Speech recognition requires an internet connection
- Check your network connectivity
- Try again with a stable connection

### No audio visualization

- Make sure you've implemented the `onAudioData` callback
- Check that your canvas element exists
- Ensure the canvas has proper dimensions

## Advanced: Using Whisper (Optional)

While this plugin uses the Web Speech API for best performance, you can optionally integrate Whisper for offline transcription:

```javascript
// Install transformers.js
// npm install @xenova/transformers

import { pipeline } from '@xenova/transformers';

const transcriber = await pipeline('automatic-speech-recognition', 
    'Xenova/whisper-tiny.en');

// Use with audio blob
const result = await transcriber(audioBlob);
console.log(result.text);
```

**Note**: Whisper requires downloading large model files (~40-200MB) and is slower than the Web Speech API.

## License

MIT License - feel free to use in your projects!

## Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Support

For issues and questions, please open an issue on the GitHub repository.

---

Made with ❤️ by the Vibgyor team
