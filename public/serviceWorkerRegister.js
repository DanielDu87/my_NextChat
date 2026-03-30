if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker
      .getRegistrations()
      .then(function (registrations) {
        return Promise.all(
          registrations.map(function (registration) {
            return registration.unregister();
          }),
        );
      })
      .catch(function (error) {
        console.error("ServiceWorker unregister failed:", error);
      });

    if ("caches" in window) {
      caches
        .keys()
        .then(function (keys) {
          return Promise.all(
            keys.map(function (key) {
              return caches.delete(key);
            }),
          );
        })
        .catch(function (error) {
          console.error("Cache cleanup failed:", error);
        });
    }

    window._SW_ENABLED = false;
  });
}
