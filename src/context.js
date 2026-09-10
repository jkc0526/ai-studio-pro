import { createContext, useContext } from 'react';

export const CanvasCtx = createContext(null);
export const useCanvas = () => useContext(CanvasCtx);

export const AppCtx = createContext(null);
export const useApp = () => useContext(AppCtx);
