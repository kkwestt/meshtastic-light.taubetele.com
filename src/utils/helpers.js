import { TIME_INTERVALS } from "./constants.js";

/**
 * Форматирует время в относительный формат (например, "2 часа назад")
 */
export function timeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) {
    return `${seconds} сек назад`;
  } else if (minutes < 60) {
    return `${minutes} мин назад`;
  } else if (hours < 24) {
    return `${hours} ч назад`;
  } else {
    return `${days} д назад`;
  }
}

/**
 * Проверяет, онлайн ли устройство
 */
export function isDeviceOnline(device) {
  const now = Date.now();
  const latestTimestamp = getLatestDeviceTimestamp(device);

  if (!latestTimestamp) return false;

  const diffSeconds = (now - latestTimestamp * 1000) / 1000;
  return diffSeconds < TIME_INTERVALS.DEVICE_ACTIVE_THRESHOLD;
}

/**
 * Проверяет, активно ли устройство (менее 12 часов назад)
 */
export function isDeviceActive(device) {
  const now = Date.now();
  const latestTimestamp = getLatestDeviceTimestamp(device);

  if (!latestTimestamp) return false;

  const diffSeconds = (now - latestTimestamp * 1000) / 1000;
  return diffSeconds < TIME_INTERVALS.DEVICE_ACTIVE_THRESHOLD;
}

/**
 * Проверяет, было ли устройство недавно активно (менее 24 часов назад)
 */
export function isDeviceRecentlyActive(device) {
  const now = Date.now();
  const latestTimestamp = getLatestDeviceTimestamp(device);

  if (!latestTimestamp) return false;

  const diffSeconds = (now - latestTimestamp * 1000) / 1000;
  return diffSeconds < TIME_INTERVALS.DEVICE_RECENTLY_ACTIVE_THRESHOLD;
}

/**
 * Проверяет, является ли устройство MQTT узлом
 */
export function isMqttNode(device) {
  // Новая структура данных - MQTT узел если gateway равен hex_id
  if (device?.gateway && device?.hex_id) {
    return device.gateway === device.hex_id;
  }

  // Старая структура данных
  return device?.user?.rxSnr === 0 && device?.user?.rxRssi === 0;
}

/**
 * Получает ID узла
 */
export function getNodeId(device) {
  // Приоритет: device_id, hex_id, user.data.id
  const nodeId = device?.device_id || device?.hex_id || device?.user?.data?.id;

  if (nodeId) {
    return nodeId;
  }

  // Если ничего не найдено, создаем уникальный ID из координат
  if (device?.latitude && device?.longitude) {
    return `node_${device.latitude.toFixed(4)}_${device.longitude.toFixed(4)}`;
  }

  return "unknown";
}

/**
 * Получает имя устройства
 */
export function getDeviceName(device) {
  // Новая структура данных (dots API)
  if (device?.longName || device?.shortName) {
    return device.longName || device.shortName;
  }

  // Приоритет: short_name, long_name, hex_id, device_id
  const deviceName =
    device?.short_name ||
    device?.long_name ||
    device?.hex_id ||
    device?.device_id ||
    device?.user?.data?.shortName ||
    device?.user?.data?.longName ||
    device?.user?.data?.id;

  if (deviceName) {
    return deviceName;
  }
}

/**
 * Получает координаты устройства
 */
export function getDeviceCoordinates(device) {
  // Новая структура данных (dots API)
  if (device?.latitude && device?.longitude) {
    return [device.latitude, device.longitude, 0];
  }

  // Новая структура данных (POSITION_APP)
  if (device?.rawData?.latitude_i && device?.rawData?.longitude_i) {
    return [
      device.rawData.latitude_i / 10000000,
      device.rawData.longitude_i / 10000000,
      device.rawData.altitude || 0,
    ];
  }

  // Старая структура данных
  const latitude = device?.position?.data?.latitudeI;
  const longitude = device?.position?.data?.longitudeI;
  const altitude = device?.position?.data?.altitude;

  if (!latitude || !longitude) return null;

  return [latitude / 10000000, longitude / 10000000, altitude || 0];
}

/**
 * Форматирует значение с резервным текстом
 */
export function formatValue(value, defaultText = "") {
  if (
    value === undefined ||
    value === null ||
    value === "" ||
    value === "undefined" ||
    value === "null" ||
    value === "Unknown" ||
    value === "unknown" ||
    value === "N/A" ||
    value === "n/a"
  ) {
    return defaultText;
  }

  // Если значение - это строка "N/A" или похожая, возвращаем defaultText
  if (typeof value === "string" && value.toLowerCase().includes("n/a")) {
    return defaultText;
  }

  // Если значение - это число 0 или отрицательное, показываем как есть
  if (typeof value === "number") {
    return value;
  }

  return value;
}

/**
 * Проверяет, находится ли точка в заданных границах
 */
export function isPointInBounds(lat, lng, bounds) {
  // Если границы не определены, считаем что точка в границах
  if (!bounds) return true;

  // Для Yandex Maps bounds - это объект с методами getSouthWest() и getNorthEast()
  if (bounds.getSouthWest && bounds.getNorthEast) {
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();

    if (sw && ne) {
      return lat >= sw[0] && lat <= ne[0] && lng >= sw[1] && lng <= ne[1];
    }
  }

  // Для массива границ (старый формат)
  if (Array.isArray(bounds) && bounds.length === 2) {
    const [[southWest], [northEast]] = bounds;
    const west = bounds[0][1];
    const east = bounds[1][1];

    return lat >= southWest && lat <= northEast && lng >= west && lng <= east;
  }

  // Если формат границ неизвестен, считаем что точка в границах
  return true;
}

/**
 * Создает debounced функцию
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Получает последний timestamp устройства
 */
export function getLatestDeviceTimestamp(device) {
  const timestamps = [];

  // Новая структура данных (POSITION_APP)
  if (device?.rawData?.time) {
    timestamps.push(device.rawData.time);
  }

  // Новая структура данных
  if (device?.last_updated) {
    timestamps.push(device.last_updated / 1000); // Конвертируем из миллисекунд в секунды
  }
  if (device?.position_time) {
    timestamps.push(device.position_time);
  }

  // Старая структура данных
  if (device?.user?.serverTime) {
    timestamps.push(device.user.serverTime);
  }
  if (device?.position?.serverTime) {
    timestamps.push(device.position.serverTime);
  }
  if (device?.deviceMetrics?.serverTime) {
    timestamps.push(device.deviceMetrics.serverTime);
  }
  if (device?.environmentMetrics?.serverTime) {
    timestamps.push(device.environmentMetrics.serverTime);
  }

  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}
