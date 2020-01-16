export interface IStringFormatterVars {
	[key: string]: string | null | undefined;
}

interface IStringFormatterInsertVarResult {
	result: string;
	length: number;
}

interface IStringFormatterGetIfPartsResult {
	if: string;
	then: string;
	else: string;
	length: number;
}

export class StringFormatter {
	public static format(pattern: string, vars: IStringFormatterVars): string {
		let result = "";
		for (let i = 0; i < pattern.length; i++) {
			const char = pattern[i];
			switch (char) {
				case ":": {
					const res = StringFormatter.insertVar(pattern, vars, i);
					result += res.result;
					i += res.length;
					break;
				}
				case "[": {
					const res = StringFormatter.getIfParts(pattern, i);
					i += res.length;
					const ifComputed = StringFormatter.format(res.if, vars);
					if (ifComputed) {
						result += StringFormatter.format(res.then, vars);
					} else {
						result += StringFormatter.format(res.else, vars);
					}
					break;
				}
				case "\\":
					i++;
					result += pattern[i];
					break;
				default:
					result += char;
			}
		}
		return result;
	}

	public static insertVar(pattern: string, vars: IStringFormatterVars, i: number): IStringFormatterInsertVarResult {
		let varName = "";
		i++;
		let length = 0;
		for (; i < pattern.length; i++) {
			const char = pattern[i];
			if (char.match(/[a-z]/)) {
				length++;
				varName += char;
			} else {
				break;
			}
		}
		return {
			result: vars[varName] || "",
			length,
		};
	}

	public static getIfParts(pattern: string, i: number): IStringFormatterGetIfPartsResult {
		const resStrs = ["", "", ""];
		const SEARCHING_IF = 0;
		const SEARCHING_THEN = 1;
		const SEARCHING_ELSE = 2;
		const SEARCHING_DONE = 3;
		let searching = 0;
		let length = 1;
		i++;
		for (; i < pattern.length; i++) {
			const char = pattern[i];
			length++;
			if (char === "[") {
				const res = StringFormatter.scanBlock(pattern, i);
				i += res.length - 1;
				length += res.length - 1;
				resStrs[searching] += res;
			} else if (char === "\\") {
				i++;
				length++;
				resStrs[searching] += "\\" + pattern[i];
			} else if (char === "?,]"[searching]) {
				searching++;
				if (searching >= SEARCHING_DONE) {
					break;
				}
			} else {
				resStrs[searching] += char;
			}
		}
		return {
			if: resStrs[SEARCHING_IF],
			then: resStrs[SEARCHING_THEN],
			else: resStrs[SEARCHING_ELSE],
			length,
		};
	}

	public static scanBlock(pattern: string, i: number): string {
		let result = "";
		let depth = 0;
		for (; i < pattern.length; i++) {
			const char = pattern[i];
			result += char;
			if (char === "\\") {
				i++;
				result += pattern[i];
			} else if (char === "[") {
				depth++;
			} else if (char === "]") {
				depth--;
				if (depth === 0) {
					break;
				}
			}
		}
		return result;
	}
}
