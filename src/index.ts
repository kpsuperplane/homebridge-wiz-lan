import {
  API
} from "homebridge";
import { PLATFORM_NAME, PLUGIN_NAME } from "./constants";
import HomebridgeWizLan from "./wiz";

export default (api: API) => {
  // Keep the historical platform alias so cached accessories written by older
  // releases can still be restored, while identifying this package correctly
  // for Homebridge's platform and accessory association bookkeeping.
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, HomebridgeWizLan as any);
};
