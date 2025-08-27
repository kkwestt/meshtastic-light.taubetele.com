import { API_CONFIG } from "./constants.js";

export const meshtasticApi = {
  async getGpsTrack(nodeId) {
    try {
      const response = await fetch(`${API_CONFIG.GPS_ENDPOINT}:${nodeId}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Ошибка получения GPS трека:", error);
      return [];
    }
  },

  async getDeviceMetrics(nodeId) {
    try {
      const response = await fetch(
        `${API_CONFIG.DEVICE_METRICS_ENDPOINT}:${nodeId}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Ошибка получения метрик устройства:", error);
      return null;
    }
  },
};
