
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GameState, P2PState } from './types';
import { LiveService } from './services/liveService';
import { PeerService } from './services/peerService';
import { Visualizer } from './components/Visualizer';

const API_KEY = process.env.API_KEY || '';

// Generate a random 4-char ID for ease of use
const generateId = () => Math.random().toString(36).substring(2, 6).toUpperCase();

export default function App() {
  const [gameState, setGameState] = useState<GameState>(GameState.MENU);
  const [isBusy, setIsBusy] = useState(false); // Prevents double clicks
  
  // AI State
  const [isAiConnected, setIsAiConnected] = useState(false);
  const liveServiceRef = useRef<LiveService | null>(null);

  // P2P State
  const [p2pState, setP2PState] = useState<P2PState>(P2PState.DISCONNECTED);
  const [myId] = useState(generateId());
  const [targetId, setTargetId] = useState('');
  const [incomingCallerId, setIncomingCallerId] = useState<string | null>(null);
  const peerServiceRef = useRef<PeerService | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // Shared State
  const [error, setError] = useState<string | null>(null);
  const [volumes, setVolumes] = useState({ input: 0, output: 0 });
  
  // --- AI HANDLERS ---
  const startAiGame = async () => {
    if (isBusy) return;
    if (!API_KEY) {
      setError("Chave de API não encontrada (process.env.API_KEY).");
      return;
    }
    
    setIsBusy(true);
    setError(null);
    setGameState(GameState.PLAYING_AI);
    
    try {
      liveServiceRef.current = new LiveService(API_KEY);
      await liveServiceRef.current.connect({
        onConnect: () => setIsAiConnected(true),
        onDisconnect: () => setIsAiConnected(false),
        onError: (err) => {
          setError(err.message);
          setIsAiConnected(false);
        },
        onVolumeChange: (input, output) => {
          setVolumes({ input, output });
        }
      });
    } catch (e: any) {
      setError("Erro ao conectar IA: " + e.message);
    } finally {
      setIsBusy(false);
    }
  };

  const stopAiGame = useCallback(() => {
    if (liveServiceRef.current) {
      liveServiceRef.current.disconnect();
      liveServiceRef.current = null;
    }
    setIsAiConnected(false);
    setGameState(GameState.GAME_OVER);
  }, []);

  // --- P2P HANDLERS ---
  const initP2P = async () => {
    if (isBusy) return;
    setIsBusy(true);
    setGameState(GameState.PLAYING_P2P);
    setP2PState(P2PState.WAITING);
    setError(null);

    try {
      peerServiceRef.current = new PeerService();
      await peerServiceRef.current.init(myId, {
        onIncomingCall: (callerId) => {
          setIncomingCallerId(callerId);
          setP2PState(P2PState.CALLING); // Receiving call state
        },
        onStream: (stream) => {
          handleRemoteStream(stream);
        },
        onClose: () => {
          setP2PState(P2PState.WAITING);
          setIncomingCallerId(null);
          setVolumes({ input: 0, output: 0 });
        }
      });

      // Start local mic immediately for volume feedback/readiness
      await peerServiceRef.current.startLocalStream();
    } catch (e: any) {
      setError("Erro ao iniciar P2P: " + e.message);
      setGameState(GameState.MENU);
    } finally {
      setIsBusy(false);
    }
  };

  const callPeer = async () => {
    if (!targetId || !peerServiceRef.current || isBusy) return;
    setIsBusy(true);
    setP2PState(P2PState.CALLING);
    setError(null);
    
    try {
      await peerServiceRef.current.makeCall(targetId.toUpperCase(), {
        onStream: (stream) => handleRemoteStream(stream),
        onClose: handleCallEnd
      });
      startP2PVolumeMonitoring();
    } catch (e: any) {
      setError("Falha na chamada: " + e.message);
      setP2PState(P2PState.WAITING);
    } finally {
      setIsBusy(false);
    }
  };

  const answerPeer = async () => {
    if (!peerServiceRef.current || isBusy) return;
    
    setIsBusy(true);
    try {
      await peerServiceRef.current.answerCall({
        onStream: (stream) => handleRemoteStream(stream),
        onClose: handleCallEnd
      });
      
      setIncomingCallerId(null);
      startP2PVolumeMonitoring();
    } catch (e: any) {
      setError("Erro ao atender: " + e.message);
      // Don't reset P2PState immediately so user sees error, 
      // but if call failed, peerService likely triggers close anyway.
    } finally {
      setIsBusy(false);
    }
  };

  const handleRemoteStream = (stream: MediaStream) => {
    console.log("Recebendo stream remoto", stream);
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = stream;
      // Explicit play attempt
      const playPromise = remoteAudioRef.current.play();
      if (playPromise !== undefined) {
        playPromise.catch(error => {
          console.error("Auto-play prevented:", error);
          setError("Clique na página para ouvir o áudio.");
        });
      }
    }
    setP2PState(P2PState.IN_CALL);
  };

  const handleCallEnd = () => {
    setP2PState(P2PState.WAITING);
    setVolumes({ input: 0, output: 0 });
  };

  const startP2PVolumeMonitoring = () => {
    peerServiceRef.current?.startVolumeMonitoring((input, output) => {
      setVolumes({ input, output });
    });
  };

  const stopP2P = () => {
    if (peerServiceRef.current) {
      peerServiceRef.current.destroy();
      peerServiceRef.current = null;
    }
    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
    setP2PState(P2PState.DISCONNECTED);
    setGameState(GameState.MENU);
  };

  // Cleanup
  useEffect(() => {
    return () => {
      if (liveServiceRef.current) liveServiceRef.current.disconnect();
      if (peerServiceRef.current) peerServiceRef.current.destroy();
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center p-4 relative overflow-hidden stars">
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-purple-900/20 to-black pointer-events-none" />
      <div className="absolute inset-0 scanline opacity-20 pointer-events-none" />
      
      {/* Audio element for P2P - Important: autoPlay */}
      <audio ref={remoteAudioRef} autoPlay className="hidden" />

      {/* Main Container */}
      <div className="relative z-10 w-full max-w-2xl bg-slate-900/90 backdrop-blur-md border border-slate-700 rounded-2xl shadow-2xl overflow-hidden flex flex-col">
        
        {/* Header */}
        <div className="p-6 border-b border-slate-700 bg-slate-800/50 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-purple-400 tracking-wider">
            COMUNICADOR UNIVERSAL
          </h1>
          <div className="flex items-center gap-2">
            <span className="text-xs font-mono text-slate-400">
              {gameState === GameState.PLAYING_AI ? 'MODO: IA' : gameState === GameState.PLAYING_P2P ? 'MODO: HUMANO' : 'OFFLINE'}
            </span>
            <div className={`w-3 h-3 rounded-full ${isAiConnected || p2pState === P2PState.IN_CALL ? 'bg-green-500 shadow-[0_0_10px_#22c55e]' : 'bg-red-500'}`} />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 p-8 min-h-[400px] flex flex-col items-center justify-center text-center">
          
          {gameState === GameState.MENU && (
            <div className="space-y-8 animate-fade-in w-full max-w-md">
              <div className="text-center space-y-2">
                <h2 className="text-white text-xl font-bold">Selecione a Frequência</h2>
                <p className="text-slate-400 text-sm">Escolha com quem deseja estabelecer comunicação.</p>
              </div>

              <div className="grid grid-cols-1 gap-4">
                <button
                  onClick={startAiGame}
                  disabled={isBusy}
                  className={`group relative p-6 bg-gradient-to-br from-purple-900/50 to-slate-900 border border-purple-500/30 rounded-xl transition-all text-left hover:shadow-[0_0_20px_rgba(168,85,247,0.2)] ${isBusy ? 'opacity-50 cursor-not-allowed' : 'hover:border-purple-500'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-purple-300 font-bold text-lg">Capitão Xylar (IA)</span>
                    <span className="text-xs bg-purple-500/20 text-purple-300 px-2 py-1 rounded">SINGLEPLAYER</span>
                  </div>
                  <p className="text-slate-400 text-sm">Negocie passagem segura com a inteligência artificial alienígena usando API Gemini.</p>
                </button>

                <button
                  onClick={initP2P}
                  disabled={isBusy}
                  className={`group relative p-6 bg-gradient-to-br from-cyan-900/50 to-slate-900 border border-cyan-500/30 rounded-xl transition-all text-left hover:shadow-[0_0_20px_rgba(34,211,238,0.2)] ${isBusy ? 'opacity-50 cursor-not-allowed' : 'hover:border-cyan-500'}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-cyan-300 font-bold text-lg">Canal Seguro (Humano)</span>
                    <span className="text-xs bg-cyan-500/20 text-cyan-300 px-2 py-1 rounded">ONLINE P2P</span>
                  </div>
                  <p className="text-slate-400 text-sm">Converse com outro jogador humano usando comunicação WebRTC em tempo real.</p>
                </button>
              </div>
              
              {error && (
                <div className="p-3 bg-red-900/50 border border-red-700 text-red-200 rounded text-sm animate-pulse">
                  {error}
                </div>
              )}
            </div>
          )}

          {gameState === GameState.PLAYING_AI && (
            <div className="w-full flex flex-col items-center justify-between h-full space-y-8 animate-fade-in">
              <div className="relative group">
                <div className={`w-40 h-40 rounded-full border-4 flex items-center justify-center bg-slate-950 transition-colors duration-500 ${volumes.output > 10 ? 'border-purple-500 shadow-[0_0_30px_#a855f7]' : 'border-slate-600'}`}>
                  <svg viewBox="0 0 100 100" className={`w-24 h-24 text-slate-300 transition-transform duration-200 ${volumes.output > 10 ? 'scale-110 text-purple-300' : ''}`}>
                     <path fill="currentColor" d="M50 10 C30 10 15 30 15 50 C15 75 30 90 50 90 C70 90 85 75 85 50 C85 30 70 10 50 10 M35 45 C32 45 30 42 30 40 C30 38 32 35 35 35 C38 35 40 38 40 40 C40 42 38 45 35 45 M65 45 C62 45 60 42 60 40 C60 38 62 35 65 35 C68 35 70 38 70 40 C70 42 68 45 65 45 M50 75 C40 75 35 65 35 65 C35 65 40 68 50 68 C60 68 65 65 65 65 C65 65 60 75 50 75" />
                  </svg>
                </div>
              </div>
              <div className="h-8 text-center w-full">
                 {error ? (
                   <span className="text-red-400 font-bold">{error}</span>
                 ) : !isAiConnected ? (
                   <span className="text-cyan-500 animate-pulse text-sm">CONECTANDO AO GEMINI...</span>
                 ) : (
                    <span className="text-purple-400 font-mono text-sm">:: LINK NEURAL ESTABELECIDO ::</span>
                 )}
              </div>
              <div className="w-full grid grid-cols-2 gap-8 p-6 bg-slate-950/50 rounded-xl border border-slate-800">
                <Visualizer level={volumes.input} color="bg-cyan-500" label="Sua Voz" />
                <Visualizer level={volumes.output} color="bg-purple-500" label="Capitão Xylar" />
              </div>
              <button onClick={stopAiGame} className="px-6 py-2 bg-red-900/30 text-red-400 border border-red-900 rounded-lg hover:bg-red-900/50 text-xs tracking-wider">ENCERRAR</button>
            </div>
          )}

          {gameState === GameState.PLAYING_P2P && (
            <div className="w-full flex flex-col items-center justify-between h-full space-y-6 animate-fade-in">
              
              {/* ID Display */}
              <div className="bg-slate-800 p-4 rounded-lg border border-slate-600 w-full max-w-sm">
                <p className="text-slate-400 text-xs uppercase mb-1">Seu ID de Comunicador</p>
                <div className="text-3xl font-mono font-bold text-cyan-400 tracking-widest select-all">{myId}</div>
                <p className="text-slate-500 text-[10px] mt-2">Compartilhe este código com outro piloto.</p>
              </div>

              {/* Status & Connection UI */}
              <div className="flex-1 w-full flex flex-col items-center justify-center space-y-6">
                
                {p2pState === P2PState.WAITING && (
                   <div className="flex flex-col gap-4 w-full max-w-xs">
                     <input 
                       type="text" 
                       maxLength={4}
                       placeholder="DIGITE O ID DO ALVO"
                       value={targetId}
                       onChange={(e) => setTargetId(e.target.value.toUpperCase())}
                       className="bg-slate-950 border border-slate-700 p-3 text-center text-white font-mono text-xl focus:border-cyan-500 outline-none rounded"
                     />
                     <button 
                       onClick={callPeer}
                       disabled={targetId.length < 4 || isBusy}
                       className={`bg-cyan-600 hover:bg-cyan-500 text-white font-bold py-3 rounded shadow-lg shadow-cyan-900/50 transition-all ${isBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                       {isBusy ? 'CONECTANDO...' : 'INICIAR CHAMADA'}
                     </button>
                   </div>
                )}

                {p2pState === P2PState.CALLING && incomingCallerId && (
                  <div className="flex flex-col items-center animate-pulse">
                    <p className="text-yellow-400 mb-4 font-bold">CHAMADA ENTRANDO DE: {incomingCallerId}</p>
                    <button 
                       onClick={answerPeer}
                       disabled={isBusy}
                       className={`bg-green-600 hover:bg-green-500 text-white font-bold px-8 py-4 rounded-full shadow-[0_0_20px_#16a34a] ${isBusy ? 'opacity-50 cursor-not-allowed' : ''}`}
                     >
                       {isBusy ? 'CONECTANDO...' : 'ATENDER'}
                     </button>
                  </div>
                )}

                {p2pState === P2PState.CALLING && !incomingCallerId && (
                  <div className="text-cyan-400 animate-pulse">CHAMANDO {targetId}...</div>
                )}

                {p2pState === P2PState.IN_CALL && (
                   <div className="w-full grid grid-cols-2 gap-8 p-6 bg-slate-950/50 rounded-xl border border-green-900/50">
                     <Visualizer level={volumes.input} color="bg-cyan-500" label="VOCÊ" />
                     <Visualizer level={volumes.output} color="bg-green-500" label="OUTRO PILOTO" />
                   </div>
                )}
                
                {error && (
                  <div className="text-red-400 text-xs mt-2">{error}</div>
                )}
              </div>

              <button onClick={stopP2P} className="px-6 py-2 bg-red-900/30 text-red-400 border border-red-900 rounded-lg hover:bg-red-900/50 text-xs tracking-wider">
                {p2pState === P2PState.IN_CALL ? 'DESLIGAR' : 'VOLTAR'}
              </button>
            </div>
          )}

          {gameState === GameState.GAME_OVER && (
            <div className="space-y-6 text-center animate-fade-in">
              <h2 className="text-3xl font-bold text-white">Sessão Finalizada</h2>
              <button
                onClick={() => setGameState(GameState.MENU)}
                className="px-6 py-3 bg-slate-700 hover:bg-slate-600 rounded-lg text-white font-medium transition-colors"
              >
                Voltar ao Menu
              </button>
            </div>
          )}
        </div>
        
        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 text-center flex justify-between px-8">
           <span className="text-[10px] text-slate-600">Gemini API (AI)</span>
           <span className="text-[10px] text-slate-600">WebRTC (P2P)</span>
        </div>
      </div>
    </div>
  );
}
