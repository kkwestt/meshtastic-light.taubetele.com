<template>
  <div id="map" class="w-full h-full" @click="handleMapClick">
    <div class="node-counter">
      <span v-if="Object.keys(devices).length === 0"
        >🔄 Загрузка данных...</span
      >
      <span v-else>
        Узлов: {{ Object.keys(devices).length }} | Видимых: {{ pointsOnMap }}
      </span>
      <div class="update-indicator" v-if="updateInterval">
        <span class="update-dot"></span>
        <span class="update-text">Автообновление</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch } from "vue";
import {
  MAP_CONFIG,
  MAP_PRESETS,
  UI_CONFIG,
  HARDWARE_MODELS,
} from "../../utils/constants.js";
import { debounce, isPointInBounds } from "../../utils/helpers.js";
import { meshtasticApi } from "../../utils/api.js";

const emit = defineEmits(["infoOpen", "devicesCount"]);

let map, openedNodeId;

const handleMapClick = (event) => {
  const { nodeId } = event.target.dataset;
  if (nodeId) {
    // Обработка клика по узлу
  }
};

const devices = ref({});
const pointsOnMap = ref(0);
const filteredDevicesCache = ref(new Map());

const filterDevicesByBounds = (devices, bounds) => {
  if (!bounds || !devices) return [];

  const cacheKey = `${bounds.getSouthWest()}-${bounds.getNorthEast()}`;

  if (filteredDevicesCache.value.has(cacheKey)) {
    return filteredDevicesCache.value.get(cacheKey);
  }

  const filtered = [];
  const now = Date.now();

  for (const index in devices) {
    const device = devices[index];

    if (!device.latitude || !device.longitude) continue;

    const deviceTime = device.s_time;
    const timeDiffHours = (now - deviceTime) / (1000 * 60 * 60);
    if (timeDiffHours > 24) continue;

    if (!isPointInBounds(device.latitude, device.longitude, bounds)) continue;

    filtered.push(device);
  }

  filteredDevicesCache.value.set(cacheKey, filtered);

  if (filteredDevicesCache.value.size > 10) {
    const firstKey = filteredDevicesCache.value.keys().next().value;
    filteredDevicesCache.value.delete(firstKey);
  }

  return filtered;
};

const debouncedRenderBallons = debounce((devices, isUpdate) => {
  renderBallons(devices, isUpdate);
}, 2000);

const formatTime = (timestamp) => {
  if (!timestamp || timestamp === "undefined" || timestamp === 0) {
    return "Неизвестно";
  }

  const numTimestamp = Number(timestamp);
  if (isNaN(numTimestamp)) {
    return "Неизвестно";
  }

  let date;
  if (Math.abs(numTimestamp) > 10000) {
    date = new Date(numTimestamp);
  } else {
    date = new Date(numTimestamp * 1000);
  }

  if (isNaN(date.getTime())) {
    return "Неизвестно";
  }

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return `${diffSeconds} сек назад`;
  } else if (diffMinutes < 60) {
    return `${diffMinutes} мин назад`;
  } else if (diffHours < 24) {
    return `${diffHours} ч назад`;
  } else if (diffDays < 7) {
    return `${diffDays} дн назад`;
  } else {
    return date.toLocaleDateString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
};

const createBalloonContent = async (device, nodeId) => {
  let nodeInfoHtml = "";

  try {
    const nodeInfo = await meshtasticApi.getNodeInfo(nodeId);
    if (nodeInfo && nodeInfo.data && nodeInfo.data.length > 0) {
      // Берем последнюю запись (самую свежую)
      const latestInfo = nodeInfo.data[0];
      const rawData = latestInfo.rawData;

      if (rawData) {
        nodeInfoHtml = `

          <div style="margin-top: 8px; padding-top: 8px; border-top: 1px solid #eee;">
            <div style="font-weight: bold; margin-bottom: 4px;">Информация об узле:</div>
            <div style="margin-top: 4px; font-size: 10px; color: #666;">
              Последнее обновление: ${formatTime(latestInfo.timestamp)}
            </div>
            <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; font-size: 11px;">
              ${
                rawData.is_unmessagable
                  ? `<span>Принимает сообщения:</span><span>${
                      !rawData.is_unmessagable ? "Да" : "Нет"
                    }</span>`
                  : ""
              }
              ${
                rawData.id
                  ? `<span>ID:</span><span>${rawData.id} (${nodeId}) </span>`
                  : ""
              }
              ${
                rawData.hw_model
                  ? `<span>Модель:</span><span>${
                      HARDWARE_MODELS[rawData.hw_model]
                    }</span>`
                  : ""
              }
              ${
                latestInfo.rxSnr !== undefined &&
                latestInfo.rxRssi !== undefined
                  ? latestInfo.rxSnr === 0 && latestInfo.rxRssi === 0
                    ? `<span>Статус:</span><span>MQTT Connected</span>`
                    : `<span>SNR:</span><span>${latestInfo.rxSnr} dB</span>
                       <span>RSSI:</span><span>${latestInfo.rxRssi} dBm</span>`
                  : ""
              }
              ${
                latestInfo.hopLimit !== undefined
                  ? `<span>Hop Limit:</span><span>${
                      7 - latestInfo.hopLimit === 0
                        ? "Direct"
                        : 7 - latestInfo.hopLimit
                    }</span>`
                  : ""
              }
              ${
                latestInfo.gatewayId
                  ? `<span>Gateway:</span><span>${latestInfo.gatewayId}</span>`
                  : ""
              }
            </div>

          </div>
        `;
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки информации об узле:", error);
  }

  return `
    <div style="max-width: 350px; font-size: 12px;">
      <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; font-family: monospace;">
        <strong>Координаты:</strong> <span>${
          device.latitude?.toFixed(6) || "N/A"
        }, ${device.longitude?.toFixed(6) || "N/A"}</span>
      </div>
      ${nodeInfoHtml}
    </div>
  `;
};

const renderPath = async (nodeId) => {
  if (!nodeId) return;

  try {
    const gpsData = await meshtasticApi.getGpsTrack(nodeId);

    if (!gpsData || !gpsData.length) return;

    const polyline = new ymaps.Polyline(
      gpsData.map(({ latitudeI, longitudeI }) => [
        latitudeI / 10000,
        longitudeI / 10000,
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

const renderBallons = (devices, isUpdate = false) => {
  try {
    if (!devices || Object.keys(devices).length === 0) {
      return;
    }

    if (isUpdate) {
      clearDeviceMarkers();
    }

    const placemarks = [];
    const state = map.action.getCurrentState();
    const now = Date.now();

    for (const index in devices) {
      const device = devices[index];
      const nodeId = device.device_id || device.hex_id || device.id || index;

      if (!device.latitude || !device.longitude) continue;

      const deviceTime = device.s_time;
      const timeDiffHours = (now - deviceTime) / (1000 * 60 * 60);

      if (timeDiffHours > 24) continue;

      const bounds = map.getBounds();
      if (!isPointInBounds(device.latitude, device.longitude, bounds)) continue;

      let presetcolor;
      if (timeDiffHours < 6) {
        presetcolor = MAP_PRESETS.ONLINE;
      } else {
        presetcolor = MAP_PRESETS.INACTIVE;
      }

      const timestampfooter = formatTime(device.s_time);

      const placemark = new window.ymaps.Placemark(
        [device.latitude, device.longitude],
        {
          iconContent: device.shortName,
          balloonContentHeader: device.longName + " (" + device.shortName + ")",
          balloonContentBody: `
      <div style="max-width: 350px; font-size: 12px;">
        <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; font-family: monospace;">
          <strong>Координаты:</strong> <span>${
            device.latitude?.toFixed(6) || "N/A"
          }, ${device.longitude?.toFixed(6) || "N/A"}</span>
        </div>
        <div style="margin-top: 8px; color: #666;">🔄 Загрузка информации об узле...</div>
      </div>
    `,
          balloonContentFooter: `Updated: ${timestampfooter}`,
          clusterCaption: `Node: <strong>${
            device.shortName || device.short_name || nodeId
          }</strong>`,
          nodeId,
        },
        { preset: `${presetcolor}` }
      );

      placemark.events.add("balloonopen", async (event) => {
        const nodeId =
          event.originalEvent.currentTarget.properties._data.nodeId;
        openedNodeId = nodeId;
        renderPath(openedNodeId);

        // Загружаем полное содержимое баллуна
        try {
          const fullContent = await createBalloonContent(device, nodeId);
          placemark.properties.set("balloonContentBody", fullContent);
        } catch (error) {
          console.error("Ошибка загрузки содержимого баллуна:", error);
          placemark.properties.set(
            "balloonContentBody",
            `
        <div style="max-width: 350px; font-size: 12px;">
          <div style="display: grid; grid-template-columns: auto 1fr; gap: 4px 8px; font-family: monospace;">
            <strong>Координаты:</strong> <span>${
              device.latitude?.toFixed(6) || "N/A"
            }, ${device.longitude?.toFixed(6) || "N/A"}</span>
          </div>
          <div style="margin-top: 8px; color: #f44336;">❌ Ошибка загрузки данных</div>
        </div>
      `
          );
        }
      });

      placemarks.push(placemark);
    }

    if (state.zoom > MAP_CONFIG.MIN_ZOOM_FOR_INDIVIDUAL_MARKERS) {
      placemarks.forEach((p) => {
        map.geoObjects.add(p);

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

      pointsOnMap.value = placemarks.length;
      return;
    }

    const clusterer = new ymaps.Clusterer({
      preset: MAP_PRESETS.CLUSTER,
      gridSize: MAP_CONFIG.CLUSTER_GRID_SIZE,
      groupByCoordinates: false,
      clusterDisableClickZoom: true,
      clusterHideIconOnBalloonOpen: false,
      geoObjectHideIconOnBalloonOpen: false,
    });

    clusterer.add(placemarks);
    map.geoObjects.add(clusterer);
    pointsOnMap.value = placemarks.length;
  } catch (error) {
    console.error("❌ Ошибка в renderBallons:", error);
    pointsOnMap.value = 0;
  }
};

const fetchDevicesData = async () => {
  try {
    const response = await fetch("https://meshtasticback.taubetele.com/dots");
    const data = await response.json();

    if (data && data.data) {
      devices.value = data.data;
      const count = Object.keys(data.data).length;
      emit("devicesCount", count);

      if (typeof debouncedRenderBallons === "function") {
        debouncedRenderBallons(devices.value, false);
      }
    } else {
      devices.value = {};
      emit("devicesCount", 0);
    }
  } catch (error) {
    console.error("❌ Ошибка загрузки данных устройств:", error);
    devices.value = {};
    emit("devicesCount", 0);
  }
};

let updateInterval = null;

const startDataUpdates = () => {
  if (updateInterval) {
    clearInterval(updateInterval);
  }

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

const clearDeviceMarkers = () => {
  if (!map) return;
  map.geoObjects.removeAll();
  pointsOnMap.value = 0;
};

const updateDevicesData = async () => {
  try {
    const response = await fetch("https://meshtasticback.taubetele.com/dots");
    const data = await response.json();

    if (data && data.data) {
      devices.value = data.data;
      const count = Object.keys(data.data).length;
      emit("devicesCount", count);

      if (typeof debouncedRenderBallons === "function") {
        debouncedRenderBallons(devices.value, true);
      }
    }
  } catch (error) {
    console.error("❌ Ошибка обновления данных устройств:", error);
  }
};

onMounted(async () => {
  startDataUpdates();

  onUnmounted(() => {
    stopDataUpdates();
  });

  const renderSelfBallon = (shouldSetCenter) => {
    if (!shouldSetCenter) return;

    ymaps.geolocation
      .get({
        provider: "auto",
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
          if (shouldSetCenter) {
            map.setCenter(MAP_CONFIG.DEFAULT_CENTER, MAP_CONFIG.DEFAULT_ZOOM);
          }
        }
      })
      .catch(function (error) {
        if (shouldSetCenter) {
          map.setCenter(MAP_CONFIG.DEFAULT_CENTER, MAP_CONFIG.DEFAULT_ZOOM);
        }
      });
  };

  const initYMap = () => {
    map = new ymaps.Map("map", {
      center: MAP_CONFIG.DEFAULT_CENTER,
      zoom: MAP_CONFIG.DEFAULT_ZOOM,
    });
    map.controls.remove("fullscreenControl");
    map.controls.remove("searchControl");

    let infoButton = new ymaps.control.Button("INFO");
    map.controls.add(infoButton, {
      selectOnClick: false,
      float: "left",
      floatIndex: 1,
    });
    infoButton.events.add("click", function () {
      emit("infoOpen");
    });

    const onBoundsChange = () => {
      filteredDevicesCache.value.clear();
      map.geoObjects.removeAll();
      pointsOnMap.value = 0;
      renderBallons(devices?.value);
    };

    map.events.add(
      "boundschange",
      debounce(onBoundsChange, UI_CONFIG.DEBOUNCE_MAP_DELAY)
    );

    map.events.add("zoomchange", () => {
      onBoundsChange();
    });
  };

  const init = async () => {
    initYMap();
    renderSelfBallon(true);
    await fetchDevicesData();
    debouncedRenderBallons(devices?.value);

    watch(devices, (newDevices) => {
      map.geoObjects?.removeAll();
      pointsOnMap.value = 0;
      filteredDevicesCache.value.clear();
      renderSelfBallon();
      debouncedRenderBallons(newDevices);
      renderPath(openedNodeId);
    });
  };

  if (window.ymaps) {
    window.ymaps.ready(() => init().catch(console.error));
  } else {
    const script = document.createElement("script");
    script.src = "https://api-maps.yandex.ru/2.1/?lang=ru_RU";
    script.async = true;

    script.onload = () => {
      if (window.ymaps) {
        window.ymaps.ready(() => init().catch(console.error));
      }
    };

    script.onerror = () => {
      console.error("❌ Ошибка загрузки Yandex Maps API");
    };

    document.head.appendChild(script);
  }
});
</script>

<style lang="scss">
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
