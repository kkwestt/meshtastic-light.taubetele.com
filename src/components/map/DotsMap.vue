<template>
  <div id="map"></div>
</template>

<script setup>
import { onMounted } from "vue";
import { MAP_CONFIG, MAP_PRESETS } from "../../utils/constants.js";

let map;

onMounted(async () => {
  const renderSelfBallon = (shouldSetCenter) => {
    let geolocation = ymaps.geolocation;
    geolocation
      .get({
        provider: "auto",
        mapStateAutoApply: false,
        timeout: 10000,
      })
      .then(function (result) {
        result.geoObjects.options.set("preset", MAP_PRESETS.GEOLOCATION);
        result.geoObjects
          .get(0)
          .properties.set({ balloonContentBody: "Вы здесь?" });
        map.geoObjects.add(result.geoObjects);

        if (shouldSetCenter) {
          map.setCenter(result.geoObjects.get(0).geometry.getCoordinates(), 10);
        }
      })
      .catch(function (error) {
        console.log("Геолокация недоступна:", error.message);
      });
  };

  const initYMap = () => {
    map = new ymaps.Map("map", {
      center: MAP_CONFIG.DEFAULT_CENTER,
      zoom: MAP_CONFIG.DEFAULT_ZOOM,
    });

    // Убираем ненужные контролы (по желанию)
    map.controls.remove("fullscreenControl");
    map.controls.remove("searchControl");

    console.log("✅ Yandex карта загружена");
  };

  const init = () => {
    initYMap();
    renderSelfBallon(true); // true означает центрировать карту на геолокации
  };

  // Загружаем Yandex Maps
  if (window.loadYandexMaps) {
    window
      .loadYandexMaps()
      .then((ymaps) => {
        ymaps.ready(init);
      })
      .catch((error) => {
        console.error("Ошибка загрузки Yandex Maps:", error);
      });
  } else {
    // Fallback для старого способа загрузки
    if (window.ymaps) {
      ymaps.ready(init);
    } else {
      console.error("Yandex Maps API не доступен");
    }
  }
});
</script>

<style lang="scss">
// Базовые стили для карты
</style>
