<template>
    <div id="app">
        <router-view></router-view>
    </div>
</template>

<script>
export default {
  name: 'app'
};

</script>

<style>
#app {
  font-family: 'Avenir', Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-align: center;
  color: #2c3e50;
  padding: 0;
  margin: 0;
  height: 100%;
}

html, body {
  padding: 0;
  margin: 0;
  background: #eee;

  /* Make sure we use the entire page */
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  right: 0;
}

</style>
