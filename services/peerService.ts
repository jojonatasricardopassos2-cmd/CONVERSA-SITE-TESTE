// Interface for the global PeerJS object loaded via CDN
declare const Peer: any;

export class PeerService {
  private peer: any;
  private myStream: MediaStream | null = null;
  private remoteStream: MediaStream | null = null;
  private call: any = null;
  
  // Audio Context for analysis
  private audioContext: AudioContext | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private remoteAnalyser: AnalyserNode | null = null;
  private volumeInterval: number | null = null;

  constructor() {}

  async init(myId: string, callbacks: {
    onIncomingCall: (callerId: string) => void;
    onStream: (stream: MediaStream) => void;
    onClose: () => void;
  }) {
    this.peer = new Peer(myId, {
      debug: 2
    });

    this.peer.on('open', (id: string) => {
      console.log('My peer ID is: ' + id);
    });

    this.peer.on('call', (incomingCall: any) => {
      console.log('Receiving call...');
      this.call = incomingCall;
      callbacks.onIncomingCall(incomingCall.peer);
    });

    this.peer.on('error', (err: any) => {
      console.error('Peer error:', err);
    });
  }

  async startLocalStream(): Promise<MediaStream> {
    this.myStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    return this.myStream;
  }

  async makeCall(remoteId: string, callbacks: {
    onStream: (stream: MediaStream) => void;
    onClose: () => void;
  }) {
    if (!this.myStream) await this.startLocalStream();
    
    this.call = this.peer.call(remoteId, this.myStream);
    this.setupCallEvents(this.call, callbacks);
  }

  async answerCall(callbacks: {
    onStream: (stream: MediaStream) => void;
    onClose: () => void;
  }) {
    if (!this.call) return;
    if (!this.myStream) await this.startLocalStream();

    this.call.answer(this.myStream);
    this.setupCallEvents(this.call, callbacks);
  }

  private setupCallEvents(call: any, callbacks: {
    onStream: (stream: MediaStream) => void;
    onClose: () => void;
  }) {
    call.on('stream', (remoteStream: MediaStream) => {
      this.remoteStream = remoteStream;
      callbacks.onStream(remoteStream);
      this.setupAudioAnalysis();
    });

    call.on('close', () => {
      this.cleanupCall();
      callbacks.onClose();
    });

    call.on('error', () => {
      this.cleanupCall();
      callbacks.onClose();
    });
  }

  private setupAudioAnalysis() {
    if (!this.myStream || !this.remoteStream) return;

    this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    
    // Input setup
    const sourceInput = this.audioContext.createMediaStreamSource(this.myStream);
    this.inputAnalyser = this.audioContext.createAnalyser();
    this.inputAnalyser.fftSize = 32;
    sourceInput.connect(this.inputAnalyser);

    // Remote setup
    const sourceRemote = this.audioContext.createMediaStreamSource(this.remoteStream);
    this.remoteAnalyser = this.audioContext.createAnalyser();
    this.remoteAnalyser.fftSize = 32;
    sourceRemote.connect(this.remoteAnalyser);
    // Note: We don't connect remote to destination here because the <audio> element in UI handles playback
  }

  startVolumeMonitoring(callback: (localVol: number, remoteVol: number) => void) {
    if (this.volumeInterval) clearInterval(this.volumeInterval);
    
    this.volumeInterval = window.setInterval(() => {
      let localVol = 0;
      let remoteVol = 0;

      if (this.inputAnalyser) {
        const data = new Uint8Array(this.inputAnalyser.frequencyBinCount);
        this.inputAnalyser.getByteFrequencyData(data);
        localVol = data.reduce((a, b) => a + b) / data.length;
      }

      if (this.remoteAnalyser) {
        const data = new Uint8Array(this.remoteAnalyser.frequencyBinCount);
        this.remoteAnalyser.getByteFrequencyData(data);
        remoteVol = data.reduce((a, b) => a + b) / data.length;
      }

      callback(localVol, remoteVol);
    }, 100);
  }

  endCall() {
    if (this.call) {
      this.call.close();
    }
    this.cleanupCall();
  }

  private cleanupCall() {
    this.call = null;
    this.remoteStream = null;
    if (this.volumeInterval) {
      clearInterval(this.volumeInterval);
      this.volumeInterval = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
  }

  destroy() {
    this.endCall();
    if (this.myStream) {
      this.myStream.getTracks().forEach(track => track.stop());
      this.myStream = null;
    }
    if (this.peer) {
      this.peer.destroy();
    }
  }
}