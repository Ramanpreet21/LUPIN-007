const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("lupinDesktop", {
  platform: process.platform,
  isElectron: true,
});
