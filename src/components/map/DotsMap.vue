<template>
  <div id="map" class="w-full h-full" @click="handleMapClick">
    <!-- Счетчик узлов в левом нижнем углу -->
    <div class="node-counter">
      <span v-if="Object.keys(devices).length === 0"
        >🔄 Загрузка данных...</span
      >
      <span v-else>Узлов: {{ Object.keys(devices).length }}</span>
      <div class="update-indicator" v-if="updateInterval">
        <span class="update-dot"></span>
        <span class="update-text">Автообновление</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import {
  ref,
  unref,
  shallowRef,
  computed,
  onMounted,
  onUnmounted,
  toRefs,
  watch,
} from "vue";

import {
  MAP_CONFIG,
  MAP_PRESETS,
  ICONS,
  TIME_INTERVALS,
  UI_CONFIG,
  HARDWARE_MODELS,
  DEVICE_ROLES,
} from "../../utils/constants.js";
import {
  timeAgo,
  isDeviceOnline,
  isDeviceActive,
  isDeviceRecentlyActive,
  isMqttNode,
  getNodeId,
  getDeviceName,
  getDeviceCoordinates,
  getBatteryLevel,
  formatValue,
  isPointInBounds,
  debounce,
  getLatestDeviceTimestamp,
} from "../../utils/helpers.js";
import { meshtasticApi } from "../../utils/api.js";
import { CONFIG } from "../../config.js";

const emit = defineEmits([
  "infoOpen",
  "chartOpen",
  "trackOpen",
  "statsOpen",
  "mapError",
  "devicesCount",
]);

let map, openedNodeId;

const handleMapClick = (event) => {
  const { nodeId, trackNodeId } = event.target.dataset;

  if (nodeId) {
    emit("chartOpen", nodeId);
  } else if (trackNodeId) {
    openedNodeId = null;
    renderPath(openedNodeId);
    // map?.geoObjects?.removeAll();
    emit("trackOpen", trackNodeId);
  }
};

// Используем константы из utils
const chartIcon = ICONS.CHART;
const trackIcon = ICONS.TRACK;

const props = defineProps({
  devices: {
    type: Object,
    default: () => ({}),
  },
  center: {
    type: Array,
    default: () => MAP_CONFIG.DEFAULT_CENTER,
  },
});

const { center } = toRefs(props);

// Добавляем реактивную переменную для устройств
const devices = ref({});

// Создаем debounced версию renderBallons с задержкой 1 секунда
const debouncedRenderBallons = debounce((devices, isUpdate) => {
  renderBallons(devices, isUpdate);
}, 1000);

// timeAgo теперь импортируется из utils/helpers.js

// Функция для форматирования времени
const formatTime = (timestamp) => {
  if (!timestamp || timestamp === "undefined" || timestamp === 0) {
    return "Неизвестно";
  }

  // Проверяем, является ли timestamp числом
  const numTimestamp = Number(timestamp);
  if (isNaN(numTimestamp)) {
    return "Неизвестно";
  }

  // Проверяем, нужно ли конвертировать из миллисекунд
  let date;
  if (Math.abs(numTimestamp) > 1000000000000) {
    // Если timestamp больше 13 цифр, это миллисекунды
    date = new Date(numTimestamp);
  } else {
    // Иначе это секунды
    date = new Date(numTimestamp * 1000);
  }

  if (isNaN(date.getTime())) {
    return "Неизвестно";
  }

  // Вычисляем разницу во времени
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Форматируем время в зависимости от давности
  if (diffSeconds < 60) {
    return `${diffSeconds} сек назад`;
  } else if (diffMinutes < 60) {
    return `${diffMinutes} мин назад`;
  } else if (diffHours < 24) {
    return `${diffHours} ч назад`;
  } else if (diffDays < 7) {
    return `${diffDays} дн назад`;
  } else {
    // Если больше недели, показываем полную дату
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
};

// Функция для получения имени шлюза
const getGatewayName = (gatewayId) => {
  if (!gatewayId || !devices.value) return "";

  // Ищем устройство с таким gateway ID
  for (const deviceId in devices.value) {
    const device = devices.value[deviceId];
    if (device.hex_id === gatewayId || device.device_id === gatewayId) {
      return device.long_name ? ` (${device.long_name})` : "";
    }
  }
  return "";
};

// Функция для создания содержимого балуна
const createBalloonContent = (device) => {
  return `
    <div style="max-width: 300px; font-size: 12px;">
      <h4 style="margin: 0 0 10px 0; color: #333;">${formatValue(
        device.longName || device.shortName,
        ""
      )}</h4>

      <div style="display: grid; grid-template-columns: auto 0.5fr; font-family: monospace; align-items: baseline;">
        <strong>Координаты:</strong> <span>${formatValue(
          device.latitude?.toFixed(6)
        )}, ${formatValue(device.longitude?.toFixed(6))}</span>
      </div>
    </div>
  `;
};

// Функция для рендеринга балунов на карте
const renderBallons = (devices, isUpdate = false) => {
  try {
    const renderStartTime = performance.now();

    // Если это обновление, сначала очищаем старые маркеры
    if (isUpdate) {
      clearDeviceMarkers();
    }

    const placemarks = [];
    var state = map.action.getCurrentState();

    let processedCount = 0;
    let skippedCoordinates = 0;
    let skippedTime = 0;
    let skippedBounds = 0;

    for (const index in devices) {
      const device = devices[index];
      // Новая структура данных - используем index как ID
      const nodeId = index;
      const coordinates = [device.latitude, device.longitude, 0];

      if (!coordinates || !device.latitude || !device.longitude) {
        skippedCoordinates++;
        continue;
      }

      // Фильтруем устройства по времени - показываем только те, что были активны в последние 24 часа
      const now = Date.now();
      const deviceTime = device.s_time;
      const timeDiffHours = (now - deviceTime) / (1000 * 60 * 60);

      if (timeDiffHours > 24) {
        skippedTime++;
        continue;
      }

      const [latitude, longitude, altitude] = coordinates;
      const name = device.shortName || device.longName || "";

      // Проверяем, находится ли точка в видимой области карты
      const bounds = map.getBounds();
      if (!isPointInBounds(latitude, longitude, bounds)) {
        skippedBounds++;
        continue;
      }

      // Определяем цвет маркера на основе времени последней активности
      let presetcolor;

      if (timeDiffHours < 6) {
        // Устройства онлайн за последние 6 часов - синие
        presetcolor = MAP_PRESETS.ONLINE;
      } else {
        // Устройства были онлайн за последние 24 часа (но не за последние 6 часов) - серые
        presetcolor = MAP_PRESETS.INACTIVE;
      }

      const timestampfooter = formatTime(device.s_time);

      const placemark = new window.ymaps.Placemark(
        [latitude, longitude],
        {
          iconContent: name,
          balloonContentHeader: formatValue(
            device.longName || device.shortName
          ),
          balloonContentBody: createBalloonContent(device),
          balloonContentFooter: `Updated: ${timestampfooter}`,
          clusterCaption: `Node: <strong>${name}</strong>`,
          nodeId,
        },
        { preset: `${presetcolor}` }
      );

      const getPlacemarkNodeId = (event) =>
        event.originalEvent.currentTarget.properties._data.nodeId;

      placemark.events.add("balloonopen", (event) => {
        const nodeId = getPlacemarkNodeId(event);
        openedNodeId = nodeId;
        renderPath(openedNodeId);
      });

      placemarks.push(placemark);
    }

    if (state.zoom > MAP_CONFIG.MIN_ZOOM_FOR_INDIVIDUAL_MARKERS) {
      placemarks.forEach((p) => {
        const res = map.geoObjects.add(p);

        if (openedNodeId && p.properties._data.nodeId === openedNodeId) {
          const length = map.geoObjects.getLength();
          const geometryObject = map.geoObjects.get(length - 1);

          geometryObject.balloon.events.add("beforeuserclose", () => {
            openedNodeId = null;
          });

          geometryObject.balloon.open(undefined, undefined, {
            balloonAutoPan: false,
          });
        }
      });

      return;
    }

    // Создание кластера и запрещение масштабирования карты при щелчке по кластеру
    var clusterer = new ymaps.Clusterer({
      preset: MAP_PRESETS.CLUSTER,
      gridSize: MAP_CONFIG.CLUSTER_GRID_SIZE,
      groupByCoordinates: false,
      clusterDisableClickZoom: true,
      clusterHideIconOnBalloonOpen: false,
      geoObjectHideIconOnBalloonOpen: false,
    });

    clusterer.add(placemarks);

    map.geoObjects.add(clusterer);

    const renderEndTime = performance.now();
    const renderTime = ((renderEndTime - renderStartTime) / 1000).toFixed(2);
  } catch (error) {
    console.error("❌ Ошибка в renderBallons:", error);
    console.error("❌ Stack trace:", error.stack);
  }
};

// Функция для загрузки данных устройств
const fetchDevicesData = async () => {
  try {
    const response = await fetch("https://meshtasticback.taubetele.com/dots");
    const data = await response.json();

    if (data && data.data) {
      devices.value = data.data;
      const count = Object.keys(data.data).length;

      // Отправляем счетчик устройств в родительский компонент
      emit("devicesCount", count);

      // Сразу рендерим балуны с новыми данными
      if (typeof debouncedRenderBallons === "function") {
        debouncedRenderBallons(devices.value, false); // false = первичная загрузка
      } else {
        console.warn(
          "⚠️ renderBallons еще не определена, откладываем рендеринг"
        );
      }
    } else {
      console.warn("⚠️ Неожиданная структура данных:", data);
      devices.value = {};
      emit("devicesCount", 0);
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки данных устройств:", error);
    devices.value = {};
    emit("devicesCount", 0);
  }
};

// Функция для периодического обновления данных
let updateInterval = null;

const startDataUpdates = () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }

  // Обновляем данные каждые 30 секунд
  updateInterval = setInterval(async () => {
    await updateDevicesData();
  }, 30000);
};

const stopDataUpdates = () => {
  if (updateInterval) {
    clearInterval(updateInterval);
    updateInterval = null;
  }
};

// Функция для очистки маркеров устройств
const clearDeviceMarkers = () => {
  if (!map) return;

  // Удаляем все маркеры устройств с карты
  map.geoObjects.removeAll();
};

// Функция для обновления данных устройств (без полной перерисовки)
const updateDevicesData = async () => {
  try {
    const response = await fetch("https://meshtasticback.taubetele.com/dots");
    const data = await response.json();

    if (data && data.data) {
      // Обновляем данные
      devices.value = data.data;
      const count = Object.keys(data.data).length;

      // Отправляем счетчик устройств в родительский компонент
      emit("devicesCount", count);

      // Рендерим балуны с флагом обновления
      if (typeof renderBallons === "function") {
        renderBallons(devices.value, true);
      } else {
        console.warn("⚠️ renderBallons не определена при обновлении");
      }
    }
  } catch (error) {
    console.error("❌ Ошибка обновления данных устройств:", error);
  }
};

// const server = useServer()

onMounted(async () => {
  let geolocationmsk = MAP_CONFIG.DEFAULT_CENTER;

  // Запускаем автоматическое обновление данных
  startDataUpdates();

  // Очищаем интервал при размонтировании компонента
  onUnmounted(() => {
    stopDataUpdates();
  });

  const renderSelfBallon = (shouldSetCenter) => {
    let geolocation = ymaps.geolocation;

    // Проверяем, было ли пользовательское взаимодействие
    if (!shouldSetCenter) {
      return;
    }

    // Пытаемся получить геолокацию с обработкой ошибок
    geolocation
      .get({
        provider: "auto", // or set "browser"
        mapStateAutoApply: false,
        timeout: 10000,
      })
      .then(function (result) {
        try {
          result.geoObjects.options.set("preset", MAP_PRESETS.GEOLOCATION);
          result.geoObjects
            .get(0)
            .properties.set({ balloonContentBody: "Вы здесь!" });
          map.geoObjects.add(result.geoObjects);

          if (shouldSetCenter) {
            map.setCenter(
              result.geoObjects.get(0).geometry.getCoordinates(),
              10
            );
          }
        } catch (error) {
          console.warn("⚠️ Ошибка при обработке геолокации:", error);
          // Fallback: центрируем карту на Москве
          if (shouldSetCenter) {
            map.setCenter(MAP_CONFIG.DEFAULT_CENTER, MAP_CONFIG.DEFAULT_ZOOM);
          }
        }
      })
      .catch(function (error) {
        console.warn("⚠️ Геолокация недоступна:", error.message);
        // Fallback: центрируем карту на Москве
        if (shouldSetCenter) {
          map.setCenter(MAP_CONFIG.DEFAULT_CENTER, MAP_CONFIG.DEFAULT_ZOOM);
        }
      });
  };

  const renderBallons = (devices, isUpdate = false) => {
    const renderStartTime = performance.now();

    // Если это обновление, сначала очищаем старые маркеры
    if (isUpdate) {
      clearDeviceMarkers();
    }

    const placemarks = [];
    var state = map.action.getCurrentState();

    for (const index in devices) {
      const device = devices[index];
      const nodeId = getNodeId(device);
      const coordinates = getDeviceCoordinates(device);

      if (!coordinates) continue;

      // Фильтруем устройства по времени - показываем только те, что были активны в последние 24 часа
      const now = Date.now();
      const deviceTime = device.s_time;
      const timeDiffHours = (now - deviceTime) / (1000 * 60 * 60);

      if (timeDiffHours > 24) {
        console.log(`⏰ Пропускаем ${index} - старше 24 часов`);
        continue;
      }

      const [latitude, longitude, altitude] = coordinates;
      const name = getDeviceName(device);
      // Временно отключаем проверку границ для отладки
      // const bounds = map.getBounds();
      // if (!isPointInBounds(latitude, longitude, bounds)) continue;

      // Определяем цвет маркера на основе времени последней активности
      let presetcolor;

      if (timeDiffHours < 6) {
        // Устройства онлайн за последние 6 часов - синие
        presetcolor = MAP_PRESETS.ONLINE;
      } else {
        // Устройства были онлайн за последние 24 часа (но не за последние 6 часов) - серые
        presetcolor = MAP_PRESETS.INACTIVE;
      }

      const timestampfooter = formatTime(device.s_time);

      let balloonContents = "";
      // if (device?.position?.data?.satsInView) {
      //   balloonContents += `<div>Sat's in view: ${device?.position?.data?.satsInView} Sat's</div>`;
      // }
      balloonContents += `<hr>`;
      const { environmentMetrics } = device?.environmentMetrics?.data || {};

      if (environmentMetrics?.temperature) {
        balloonContents += `<button class="track-button" type="button" data-node-id="${nodeId}">${chartIcon}</button> Sensors: `;
      }

      if (environmentMetrics?.temperature)
        balloonContents += `${Number(environmentMetrics?.temperature).toFixed(
          1
        )} <iii style="color:grey;">C</iii> `;
      if (environmentMetrics?.relativeHumidity)
        balloonContents += `${Number(
          device?.environmentMetrics?.data?.environmentMetrics?.relativeHumidity
        ).toFixed(0)} <iii style="color:grey;">%</iii> `;
      if (environmentMetrics?.barometricPressure)
        balloonContents += `${Math.round(
          device?.environmentMetrics?.data?.environmentMetrics
            ?.barometricPressure
        )} <iii style="color:grey;">hPa </iii>`;
      if (environmentMetrics?.gasResistance)
        balloonContents += `<div>Gas Resistance (AQI): ${Number(
          device?.environmentMetrics?.data?.environmentMetrics?.gasResistance
        ).toFixed(0)} <iii style="color:grey;"> MOhms </iii></div>`;

      const { deviceMetrics } = device?.deviceMetrics?.data || {};
      if (deviceMetrics?.batteryLevel) {
        balloonContents += `<div>`;

        if (!environmentMetrics) {
          balloonContents += `<button class="track-button" type="button" data-node-id="${nodeId}">${chartIcon} </button> `;
        }

        balloonContents += ` Battery: ${
          Number(
            device?.deviceMetrics?.data?.deviceMetrics?.batteryLevel
          ).toFixed(0) > 100
            ? 100
            : Number(
                device?.deviceMetrics?.data?.deviceMetrics?.batteryLevel
              ).toFixed(0)
        }<iii style="color:grey;">%</iii> (${Number(
          device?.deviceMetrics?.data?.deviceMetrics?.voltage
        ).toFixed(2)} <iii style="color:grey;">V</iii>) </div>`;
      }
      if (deviceMetrics?.airUtilTx) {
        balloonContents += `<div>
    Air util TX: ${Number(
      device?.deviceMetrics?.data?.deviceMetrics?.airUtilTx
    ).toFixed(1)}<iii style="color:grey;">%</iii>,
    Channel util: ${Number(
      device?.deviceMetrics?.data?.deviceMetrics?.channelUtilization
    ).toFixed(1)}<iii style="color:grey;">%</iii>
    </div>
    <hr>`;
      }

      if (
        device?.user?.rxRssi !== undefined &&
        device?.user?.rxSnr !== undefined &&
        device?.user?.rxRssi !== 0
      ) {
        balloonContents += `<div>
    Node Info RSSI: ${Math.round(device?.user?.rxRssi).toFixed(0)},
    SNR: ${Math.round(device?.user?.rxSnr).toFixed(0)}`;
        if (device?.user?.hopLimit) {
          balloonContents += ` Hop: ${Number(device?.user?.hopLimit)} `;
        }
        if (device?.user?.gatewayId) {
          balloonContents += ` GW: ${device?.user?.gatewayId} `;
        }
        if (
          Date.now() - device?.user?.serverTime * 1000 <
          TIME_INTERVALS.MESSAGE_VISIBILITY_THRESHOLD * 1000
        ) {
          balloonContents += `<iii style="color:grey;"> (${timeAgo(
            new Date(device?.user?.serverTime).getTime()
          )})</iii>`;
        }

        balloonContents += `</div>`;
      }
      if (
        device?.position?.rxRssi !== undefined &&
        device?.position?.rxSnr !== undefined &&
        device?.position?.rxRssi !== 0
      ) {
        balloonContents += `<div>
    Position RSSI: ${Math.round(device?.position?.rxRssi).toFixed(0)},
    SNR: ${Math.round(device?.position?.rxSnr).toFixed(0)}`;
        if (device?.position?.hopLimit) {
          balloonContents += ` Hop: ${Number(device?.position?.hopLimit)} `;
        }
        if (device?.position?.gatewayId) {
          balloonContents += ` GW: ${device?.position?.gatewayId} `;
        }
        if (
          Date.now() - device?.position?.serverTime * 1000 <
          TIME_INTERVALS.MESSAGE_VISIBILITY_THRESHOLD * 1000
        ) {
          balloonContents += `<iii style="color:grey;"> (${timeAgo(
            new Date(device?.position?.serverTime).getTime()
          )})</iii>`;
        }
        balloonContents += `</div>`;
      }
      if (
        device?.deviceMetrics?.rxRssi !== undefined &&
        device?.deviceMetrics?.rxSnr !== undefined &&
        device?.deviceMetrics?.rxRssi !== 0
      ) {
        balloonContents += `<div>
    Device Metrics RSSI: ${Math.round(device?.deviceMetrics?.rxRssi).toFixed(
      0
    )},
    SNR: ${Math.round(device?.deviceMetrics?.rxSnr).toFixed(0)}`;
        if (device?.deviceMetrics?.hopLimit) {
          balloonContents += ` Hop: ${Number(
            device?.deviceMetrics?.hopLimit
          )} `;
        }
        if (device?.deviceMetrics?.gatewayId) {
          balloonContents += ` GW: ${device?.deviceMetrics?.gatewayId} `;
        }
        if (
          Date.now() - device?.deviceMetrics?.serverTime * 1000 <
          TIME_INTERVALS.MESSAGE_VISIBILITY_THRESHOLD * 1000
        ) {
          balloonContents += `<iii style="color:grey;"> (${timeAgo(
            new Date(device?.deviceMetrics?.serverTime).getTime()
          )})</iii>`;
        }
        balloonContents += `</div>`;
      }

      if (
        device?.environmentMetrics?.rxRssi !== undefined &&
        device?.environmentMetrics?.rxSnr !== undefined &&
        device?.environmentMetrics?.rxRssi !== 0
      ) {
        balloonContents += `<div>
    Environment RSSI: ${Math.round(device?.environmentMetrics?.rxRssi).toFixed(
      0
    )},
    SNR: ${Math.round(device?.environmentMetrics?.rxSnr).toFixed(0)}`;

        if (device?.environmentMetrics?.hopLimit) {
          balloonContents += ` Hop: ${Number(
            device?.environmentMetrics?.hopLimit
          )} `;
        }
        if (device?.environmentMetrics?.gatewayId) {
          balloonContents += ` GW: ${device?.environmentMetrics?.gatewayId} `;
        }
        if (
          Date.now() - device?.environmentMetrics?.serverTime * 1000 <
          TIME_INTERVALS.MESSAGE_VISIBILITY_THRESHOLD * 1000
        ) {
          balloonContents += `<iii style="color:grey;"> (${timeAgo(
            new Date(device?.environmentMetrics?.serverTime).getTime()
          )})</iii>`;
        }
        balloonContents += `</div>`;
      }

      if (device?.user?.rxSnr === 0 && device?.user?.rxRssi === 0) {
        balloonContents += `<hr><div class="font-bold">MQTT: YES </div>`;
        balloonContents += `<div>Server: ${device?.server}</div>`;
      }
      if (device?.message?.data !== undefined) {
        balloonContents += `<hr><div>Last public message: ${device.message.data}`;
        if (
          Date.now() - device?.environmentMetrics?.serverTime * 1000 <
          TIME_INTERVALS.MESSAGE_VISIBILITY_THRESHOLD * 1000
        ) {
          balloonContents += `<iii style="color:grey;"> (${timeAgo(
            new Date(device?.message?.serverTime).getTime()
          )})</iii>`;
        }
        if (device?.environmentMetrics?.gatewayId) {
          balloonContents += ` GW: ${device?.environmentMetrics?.gatewayId} `;
        }

        balloonContents += `</div>`;
      }

      const placemark = new window.ymaps.Placemark(
        [latitude, longitude],
        {
          iconContent: name,
          balloonContentHeader: formatValue(
            device.longName || device.shortName,
            ""
          ),
          balloonContentBody: createBalloonContent(device),
          balloonContentFooter: `Updated: ${timestampfooter}`,
          clusterCaption: `Node: <strong>${name}</strong>`,
          nodeId,
        },
        { preset: `${presetcolor}` }
      );

      const getPlacemarkNodeId = (event) =>
        event.originalEvent.currentTarget.properties._data.nodeId;

      placemark.events.add("balloonopen", (event) => {
        const nodeId = getPlacemarkNodeId(event);
        openedNodeId = nodeId;
        renderPath(openedNodeId);
        console.log("!!! balloonopen", openedNodeId);
      });

      // placemark.events.add("balloonclose", (event) => {
      //   const nodeId = getPlacemarkNodeId(event);
      //   console.log("!!! event:balloonclose", event, nodeId);
      // });

      placemarks.push(placemark);
    }

    if (state.zoom > MAP_CONFIG.MIN_ZOOM_FOR_INDIVIDUAL_MARKERS) {
      placemarks.forEach((p) => {
        const res = map.geoObjects.add(p);

        if (openedNodeId && p.properties._data.nodeId === openedNodeId) {
          const length = map.geoObjects.getLength();
          const geometryObject = map.geoObjects.get(length - 1);

          geometryObject.balloon.events.add("beforeuserclose", () => {
            console.log("!!! beforeuserclose", openedNodeId);
            openedNodeId = null;
          });

          geometryObject.balloon.open(undefined, undefined, {
            balloonAutoPan: false,
          });
        }
      });

      return;
    }

    // Создание кластера и запрещение масштабирования карты при щелчке по кластеру
    var clusterer = new ymaps.Clusterer({
      preset: MAP_PRESETS.CLUSTER,
      gridSize: MAP_CONFIG.CLUSTER_GRID_SIZE,
      groupByCoordinates: false,
      clusterDisableClickZoom: true,
      clusterHideIconOnBalloonOpen: false,
      geoObjectHideIconOnBalloonOpen: false,
    });

    clusterer.add(placemarks);

    map.geoObjects.add(clusterer);

    const renderEndTime = performance.now();
    const renderTime = ((renderEndTime - renderStartTime) / 1000).toFixed(2);
    console.log(
      `🎨 Рендеринг ${placemarks.length} балунов завершен за ${renderTime}s`
    );

    // if (window.openedNodeId && window.openedNodeId === nodeId) {
    // placemark.o
    // }
  };

  const renderPath = async (nodeId) => {
    if (!nodeId) return;

    try {
      const gpsData = await meshtasticApi.getGpsTrack(nodeId);

      if (!gpsData || !gpsData.length) return;

      const polyline = new ymaps.Polyline(
        gpsData.map(({ latitudeI, longitudeI }) => [
          latitudeI / 10000000,
          longitudeI / 10000000,
        ]),
        {},
        {
          strokeColor: MAP_CONFIG.PATH_STROKE_COLOR,
          strokeWidth: MAP_CONFIG.PATH_STROKE_WIDTH,
        }
      );

      map.geoObjects.add(polyline);
    } catch (error) {
      console.error("Ошибка отображения пути:", error);
    }
  };

  const initYMap = () => {
    map = new ymaps.Map("map", {
      center: geolocationmsk,
      zoom: MAP_CONFIG.DEFAULT_ZOOM,
    });
    map.controls.remove("fullscreenControl");
    map.controls.remove("searchControl");

    let statsButton = new ymaps.control.Button("STATS");
    map.controls.add(statsButton, {
      selectOnClick: false,
      float: "left",
      floatIndex: 2,
    });
    statsButton.events.add("click", function () {
      emit("statsOpen");
    });

    let infoButton = new ymaps.control.Button("INFO");
    map.controls.add(infoButton, {
      selectOnClick: false,
      float: "left",
      floatIndex: 1,
    });
    infoButton.events.add("click", function () {
      emit("infoOpen");
    });

    const onBoundsChange = (e) => {
      map.geoObjects.removeAll();
      renderBallons(devices?.value);
    };
    map.events.add(
      "boundschange",
      debounce(onBoundsChange, UI_CONFIG.DEBOUNCE_MAP_DELAY)
    );

    map.events.add("dblclick", function () {
      console.log("dblclick");
    });
  };

  const init = async () => {
    initYMap();
    renderSelfBallon(true);

    await fetchDevicesData();

    // Рендерим маркеры после загрузки данных
    renderBallons(devices?.value);

    watch(devices, (newDevices) => {
      // следит за обновлениями данных
      map.geoObjects?.removeAll();
      renderSelfBallon();
      renderBallons(newDevices);
      renderPath(openedNodeId);
    });

    watch(center, (newValue) => {
      const zoom = 16;
      map.setCenter(newValue, zoom);
    });
  };

  // Загружаем Yandex Maps с API ключом
  if (window.ymaps) {
    // API уже загружен
    window.ymaps.ready(() => init().catch(console.error));
  } else {
    // Пытаемся загрузить API
    const script = document.createElement("script");

    // Проверяем наличие API ключа
    if (!CONFIG.YANDEX_MAPS_API_KEY) {
      console.warn(
        "⚠️ API ключ Yandex Maps не найден. Карта может работать с ограничениями."
      );
      script.src = "https://api-maps.yandex.ru/2.1/?lang=ru_RU";
    } else {
      script.src = `${CONFIG.YANDEX_MAPS_API_URL}&apikey=${CONFIG.YANDEX_MAPS_API_KEY}`;
    }

    script.async = true;

    script.onload = () => {
      if (window.ymaps) {
        window.ymaps.ready(() => init().catch(console.error));
      } else {
        console.error("❌ Yandex Maps API не загружен");
        emit("mapError", {
          type: "yandex_maps_load_error",
          message:
            "Не удалось загрузить карты. Проверьте подключение к интернету.",
        });
      }
    };

    script.onerror = () => {
      console.error("❌ Ошибка загрузки Yandex Maps API");
      emit("mapError", {
        type: "yandex_maps_load_error",
        message:
          "Не удалось загрузить карты. Проверьте подключение к интернету.",
      });
    };

    document.head.appendChild(script);
  }
});

const filter = shallowRef("");

// this is actually a setFilter
const addToFilter = (item) => {
  // console.debug('addToFilter item', item)
  filter.value = item;
};

const filtered = computed(() => {
  if (!filter.value) {
    return Object.keys(devices.value);
  } else {
    const candidates = {};
    const needle = filter.value.toLowerCase();
    for (const candidate in devices.value) {
      // console.log(
      // devices.value[candidate].server,
      // devices.value[candidate]?.user?.data?.shortName,
      // devices.value[candidate]?.user?.data?.longName,
      // devices.value[candidate]?.user?.data?.id
      // )
      if (devices.value[candidate].server.match(needle)) {
        candidates[candidate] = devices.value[candidate];
      } else if (
        devices.value[candidate]?.user?.data?.shortName
          .toLowerCase()
          .match(needle)
      ) {
        candidates[candidate] = devices.value[candidate];
      } else if (
        devices.value[candidate]?.user?.data?.longName
          .toLowerCase()
          .match(needle)
      ) {
        candidates[candidate] = devices.value[candidate];
      } else if (
        devices.value[candidate]?.user?.data?.id.toLowerCase().match(needle)
      ) {
        candidates[candidate] = devices.value[candidate];
      }
    }
    return Object.keys(candidates);
  }
});

const servers = computed(() => {
  if (devices.value === undefined) {
    return [];
  }
  const candidates = new Set();
  for (const candidate in devices.value) {
    candidates.add(devices.value[candidate].server);
  }
  // console.log('C', candidates)
  return Array.from(candidates);
});
</script>

<style lang="scss">
/* Pls install PostCSS Language Support extension */

/* 
 * Color converter here
 * https://isotropic.co/tool/hex-color-to-css-filter/
 */
.filter-icon {
  filter: invert(73%) sepia(0%) saturate(0%) hue-rotate(187deg) brightness(90%)
    contrast(86%);
}

.top-menu {
  @apply fixed top-0 z-50;
  @apply flex flex-row items-center;
  @apply w-full h-10;
  @apply gap-1 md:gap-2 lg:gap-4;
  @apply pl-3;
  @apply border-b;
  @apply bg-neutral-100;
}

.text-breakpoints {
  @media (max-width: 500px) {
    @apply text-[12px];
  }
  @media (min-width: 500px) and (max-width: 600px) {
    @apply text-sm;
  }
}

.chart-button {
  font-size: 14px;
  color: blue;
  svg {
    pointer-events: none;
  }
}
.track-button {
  font-size: 14px;
  color: blue;
  svg {
    pointer-events: none;
  }
}

// Стили для счетчика узлов
.node-counter {
  position: absolute;
  bottom: 35px;
  left: 7px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(5px);
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #333;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  border: 1px solid rgba(0, 0, 0, 0.1);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  z-index: 1000;
  user-select: none;
  pointer-events: none;
}

.update-indicator {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
  font-size: 11px;
  color: #666;
}

.update-dot {
  width: 6px;
  height: 6px;
  background: #4caf50;
  border-radius: 50%;
  animation: pulse 2s infinite;
}

.update-text {
  font-size: 10px;
}

@keyframes pulse {
  0% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
  100% {
    opacity: 1;
  }
}
</style>
