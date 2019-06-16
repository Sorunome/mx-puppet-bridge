export class MxBridgeConfig {
	public bridge: MxBridgeConfigBridge = new MxBridgeConfigBridge();
	public logging: MxBridgeConfigLogging = new MxBridgeConfigLogging();
	public database: MxBridgeConfigDatabase = new MxBridgeConfigDatabase();

	public applyConfig(newConfig: {[key: string]: any}, configLayer: {[key: string]: any} = this) {
		  Object.keys(newConfig).forEach((key) => {
			if (configLayer[key] instanceof Object && !(configLayer[key] instanceof Array)) {
				this.applyConfig(newConfig[key], configLayer[key]);
			} else {
				configLayer[key] = newConfig[key];
			}
		});
	}
}

class MxBridgeConfigBridge {
	public bindAddress: string;
	public port: number; 
	public domain: string;
	public homeserverUrl: string;
}

export class MxBridgeConfigLogging {
	public console: string = "info";
	public lineDateFormat: string = "MMM-D HH:mm:ss.SSS";
	public files: LoggingFile[] = [];
}

export class LoggingFile {
	public file: string;
	public level: string = "info";
	public maxFiles: string = "14d";
	public maxSize: string|number = "50m";
	public datePattern: string = "YYYY-MM-DD";
	public enabled: string[] = [];
	public disabled: string[] = [];
}

export class MxBridgeConfigDatabase {
	public connString: string;
	public filename: string;
	public userStorePath: string;
	public roomStorePath: string;
}
