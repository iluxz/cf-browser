import { onRequest as __api_proxy_js_onRequest } from "D:\\OpenCode\\cf-browser\\functions\\api\\proxy.js"

export const routes = [
    {
      routePath: "/api/proxy",
      mountPath: "/api",
      method: "",
      middlewares: [],
      modules: [__api_proxy_js_onRequest],
    },
  ]