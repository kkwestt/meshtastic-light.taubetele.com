<template>
  <!-- Простая Yandex карта -->
  <dots-map />
</template>

<script setup>
import DotsMap from "./components/map/DotsMap.vue";

// Информация о приложении
console.log("🗺️ Простая Yandex карта загружается...");
</script>

<style lang="scss">
// Убираем все лишние стили, оставляем только базовые
html,
body {
  margin: 0;
  padding: 0;
  width: 100%;
  height: 100%;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto",
    sans-serif;
}

#app {
  width: 100%;
  height: 100vh;
  position: relative;
}

#map {
  width: 100%;
  height: 100vh;
}
</style>
