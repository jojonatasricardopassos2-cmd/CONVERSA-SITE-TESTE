import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { createPcmBlob, decodeBase64, pcmToAudioBuffer } from '../utils/audioUtils';

interface LiveServiceCallbacks {
  onConnect?: () => void;
  onDisconnect?: () => void;
  onVolumeChange?: (inputVol: number, outputVol: number) => void;
  onError?: (error: Error) => void;
}

export class LiveService {
  private ai: GoogleGenAI;
  private inputAudioContext: AudioContext | null = null;
  private outputAudioContext: AudioContext | null = null;
  private inputSource: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private outputNode: GainNode | null = null;
  private audioSources = new Set<AudioBufferSourceNode>();
  private nextStartTime = 0;
  private stream: MediaStream | null = null;
  private isConnected = false;
  private sessionPromise: Promise<any> | null = null; // Using any for the Session type from SDK
  
  // Volume analysis
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private volumeInterval: number | null = null;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async connect(callbacks: LiveServiceCallbacks) {
    if (this.isConnected) return;

    try {
      // 1. Initialize Audio Contexts
      this.inputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      this.outputAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      
      // Setup Analysers for visualization
      this.inputAnalyser = this.inputAudioContext.createAnalyser();
      this.outputAnalyser = this.outputAudioContext.createAnalyser();
      this.inputAnalyser.fftSize = 32;
      this.outputAnalyser.fftSize = 32;

      this.outputNode = this.outputAudioContext.createGain();
      this.outputNode.connect(this.outputAudioContext.destination);
      this.outputNode.connect(this.outputAnalyser);

      // 2. Get Microphone Stream
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      // 3. Connect to Gemini Live
      const model = 'gemini-2.5-flash-native-audio-preview-09-2025';
      const config = {
        model,
        callbacks: {
          onopen: () => {
            console.log("Gemini Live Session Opened");
            this.isConnected = true;
            this.startAudioInputStreaming();
            callbacks.onConnect?.();
            this.startVolumeMonitoring(callbacks.onVolumeChange);
          },
          onmessage: async (message: LiveServerMessage) => {
             this.handleServerMessage(message);
          },
          onclose: () => {
            console.log("Gemini Live Session Closed");
            this.disconnect();
            callbacks.onDisconnect?.();
          },
          onerror: (err: any) => {
            console.error("Gemini Live Error", err);
            callbacks.onError?.(new Error(err.message || "Unknown error"));
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } },
          },
          systemInstruction: `
            Você é o Capitão Xylar, um comandante alienígena endurecido pela batalha.
            O usuário é um diplomata humano tentando negociar uma passagem segura pelo seu setor.
            Fale SEMPRE em Português do Brasil.
            Seja cético, levemente sarcástico, mas justo. Não ceda facilmente.
            Mantenha suas respostas curtas (máximo 2 frases) para um diálogo fluido.
            Se o usuário for educado e convincente, concorde. Se for rude, ameace destruir a nave dele.
          `,
        },
      };

      this.sessionPromise = this.ai.live.connect(config);

    } catch (error) {
      console.error("Failed to connect:", error);
      callbacks.onError?.(error as Error);
      this.disconnect();
    }
  }

  private startAudioInputStreaming() {
    if (!this.inputAudioContext || !this.stream || !this.sessionPromise) return;

    this.inputSource = this.inputAudioContext.createMediaStreamSource(this.stream);
    this.inputSource.connect(this.inputAnalyser!); // Connect to analyser
    
    // Using ScriptProcessor as per SDK guide for raw PCM streaming
    this.processor = this.inputAudioContext.createScriptProcessor(4096, 1, 1);
    
    this.processor.onaudioprocess = (e) => {
      const inputData = e.inputBuffer.getChannelData(0);
      const pcmBlob = createPcmBlob(inputData);
      
      this.sessionPromise?.then((session) => {
        session.sendRealtimeInput({ media: pcmBlob });
      });
    };

    this.inputSource.connect(this.processor);
    this.processor.connect(this.inputAudioContext.destination);
  }

  private async handleServerMessage(message: LiveServerMessage) {
    if (!this.outputAudioContext || !this.outputNode) return;

    // Handle Audio
    const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
    if (base64Audio) {
      this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
      
      const rawBytes = decodeBase64(base64Audio);
      const audioBuffer = pcmToAudioBuffer(rawBytes, this.outputAudioContext);
      
      const source = this.outputAudioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.outputNode);
      
      source.addEventListener('ended', () => {
        this.audioSources.delete(source);
      });

      source.start(this.nextStartTime);
      this.nextStartTime += audioBuffer.duration;
      this.audioSources.add(source);
    }

    // Handle Interruption
    if (message.serverContent?.interrupted) {
      console.log("Audio Interrupted");
      this.audioSources.forEach(src => {
        try { src.stop(); } catch(e) {}
      });
      this.audioSources.clear();
      this.nextStartTime = 0;
    }
  }

  private startVolumeMonitoring(callback?: (inVol: number, outVol: number) => void) {
    if (!callback) return;
    
    this.volumeInterval = window.setInterval(() => {
      let inputVol = 0;
      let outputVol = 0;

      if (this.inputAnalyser) {
        const data = new Uint8Array(this.inputAnalyser.frequencyBinCount);
        this.inputAnalyser.getByteFrequencyData(data);
        inputVol = data.reduce((a, b) => a + b) / data.length;
      }

      if (this.outputAnalyser) {
        const data = new Uint8Array(this.outputAnalyser.frequencyBinCount);
        this.outputAnalyser.getByteFrequencyData(data);
        outputVol = data.reduce((a, b) => a + b) / data.length;
      }

      callback(inputVol, outputVol);
    }, 100);
  }

  disconnect() {
    this.isConnected = false;
    
    // Stop Audio
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    
    if (this.inputSource) {
      this.inputSource.disconnect();
      this.inputSource = null;
    }

    if (this.inputAudioContext) {
      this.inputAudioContext.close();
      this.inputAudioContext = null;
    }
    
    if (this.outputAudioContext) {
      this.outputAudioContext.close();
      this.outputAudioContext = null;
    }

    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }

    // Attempt to close session if SDK supported it explicitly via session object, 
    // but usually disconnect cleans up the socket.
    // We can rely on just stopping the client side for this demo.
  }
}