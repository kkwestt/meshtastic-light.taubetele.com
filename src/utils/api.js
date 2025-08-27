import { API_CONFIG } from "./constants.js";

/**
 * API для работы с Meshtastic данными
 */
export const meshtasticApi = {
  /**
   * Получает GPS трек для узла
   */
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

  /**
   * Получает метрики устройства
   */
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

  /**
   * Получает метрики окружающей среды
   */
  async getEnvironmentMetrics(nodeId) {
    try {
      const response = await fetch(
        `${API_CONFIG.ENVIRONMENT_METRICS_ENDPOINT}:${nodeId}`
      );
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Ошибка получения метрик окружающей среды:", error);
      return null;
    }
  },

  /**
   * Получает все устройства
   */
  async getAllDevices() {
    try {
      const response = await fetch(`${API_CONFIG.BASE_URL_MAIN}/devices`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Ошибка получения списка устройств:", error);
      return {};
    }
  },
};
