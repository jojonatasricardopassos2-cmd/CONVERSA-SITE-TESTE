export enum GameState {
  MENU = 'MENU',
  PLAYING_AI = 'PLAYING_AI',
  PLAYING_P2P = 'PLAYING_P2P',
  GAME_OVER = 'GAME_OVER'
}

export interface AudioVisualizerData {
  inputVolume: number;
  outputVolume: number;
}

export interface MessageLog {
  id: string;
  sender: 'user' | 'ai';
  text: string;
}

export enum P2PState {
  DISCONNECTED = 'DISCONNECTED',
  WAITING = 'WAITING',
  CALLING = 'CALLING',
  IN_CALL = 'IN_CALL'
}