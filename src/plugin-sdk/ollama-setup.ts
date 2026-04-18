type FacadeModule = typeof import("@openclaw/ollama/api.js");
import { loadBundledPluginPublicSurfaceModuleSync } from "./facade-loader.js";

export type {
  OpenClawPluginApi,
  ProviderAuthContext,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthResult,
  ProviderDiscoveryContext,
} from "../plugins/types.js";

function loadFacadeModule(): FacadeModule {
  return loadBundledPluginPublicSurfaceModuleSync<FacadeModule>({
    dirName: "ollama",
    artifactBasename: "api.js",
  });
}

export const OLLAMA_DEFAULT_BASE_URL: FacadeModule["OLLAMA_DEFAULT_BASE_URL"] =
  loadFacadeModule().OLLAMA_DEFAULT_BASE_URL;
export const OLLAMA_DEFAULT_CONTEXT_WINDOW: FacadeModule["OLLAMA_DEFAULT_CONTEXT_WINDOW"] =
  loadFacadeModule().OLLAMA_DEFAULT_CONTEXT_WINDOW;
export const OLLAMA_DEFAULT_COST: FacadeModule["OLLAMA_DEFAULT_COST"] =
  loadFacadeModule().OLLAMA_DEFAULT_COST;
export const OLLAMA_DEFAULT_MAX_TOKENS: FacadeModule["OLLAMA_DEFAULT_MAX_TOKENS"] =
  loadFacadeModule().OLLAMA_DEFAULT_MAX_TOKENS;
export const OLLAMA_DEFAULT_MODEL: FacadeModule["OLLAMA_DEFAULT_MODEL"] =
  loadFacadeModule().OLLAMA_DEFAULT_MODEL;

export const buildOllamaProvider: FacadeModule["buildOllamaProvider"] = ((...args) =>
  loadFacadeModule().buildOllamaProvider(...args)) as FacadeModule["buildOllamaProvider"];
export const configureOllamaNonInteractive: FacadeModule["configureOllamaNonInteractive"] = ((
  ...args
) =>
  loadFacadeModule().configureOllamaNonInteractive(
    ...args,
  )) as FacadeModule["configureOllamaNonInteractive"];
export const ensureOllamaModelPulled: FacadeModule["ensureOllamaModelPulled"] = ((...args) =>
  loadFacadeModule().ensureOllamaModelPulled(...args)) as FacadeModule["ensureOllamaModelPulled"];
export const promptAndConfigureOllama: FacadeModule["promptAndConfigureOllama"] = ((...args) =>
  loadFacadeModule().promptAndConfigureOllama(...args)) as FacadeModule["promptAndConfigureOllama"];
