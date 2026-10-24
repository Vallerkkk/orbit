'use strict';
// Ponte mínima para os controles da janela sem moldura. Nada além de minimizar/fechar é exposto.
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('orbitaDesktop',Object.freeze({minimize:()=>ipcRenderer.send('orbita-window','minimize'),close:()=>ipcRenderer.send('orbita-window','close')}));
