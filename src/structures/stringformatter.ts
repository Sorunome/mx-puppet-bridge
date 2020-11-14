/*
Copyright 2020 mx-puppet-bridge
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at
    http://www.apache.org/licenses/LICENSE-2.0
Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

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
					const ifComputed = StringFormatter.condition(res.if, vars);
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
			if (char.match(/[a-z0-9]/)) {
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
				const res = StringFormatter.scanBlock(pattern, i, "[]");
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
		length--; // else we gobble the ] twice
		return {
			if: resStrs[SEARCHING_IF],
			then: resStrs[SEARCHING_THEN],
			else: resStrs[SEARCHING_ELSE],
			length,
		};
	}

	public static scanBlock(pattern: string, i: number, chars: string): string {
		let result = "";
		let depth = 0;
		for (; i < pattern.length; i++) {
			const char = pattern[i];
			result += char;
			if (char === "\\") {
				i++;
				result += pattern[i];
			} else if (char === chars[0]) {
				depth++;
			} else if (char === chars[1]) {
				depth--;
				if (depth === 0) {
					break;
				}
			}
		}
		return result;
	}

	public static condition(pattern: string, vars: IStringFormatterVars): string {
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
				case "=": {
					const res = StringFormatter.condition(pattern.substr(i + 1), vars);
					if (res === result) {
						if (!res) {
							return "true";
						}
						return res;
					}
					return "";
				}
				case "|": {
					if (result) {
						return result;
					}
					return StringFormatter.condition(pattern.substr(i + 1), vars);
				}
				case "&": {
					if (!result) {
						return "";
					}
					return StringFormatter.condition(pattern.substr(i + 1), vars);
				}
				case "^": {
					const res = StringFormatter.condition(pattern.substr(i + 1), vars);
					const res1 = result ? 1 : 0;
					const res2 = res ? 1 : 0;
					if (res1 ^ res2) { // tslint:disable-line no-bitwise
						return result || res;
					}
					return "";
				}
				case "(": {
					const res = StringFormatter.scanBlock(pattern, i, "()");
					i += res.length - 1;
					result += StringFormatter.condition(res.substring(1, res.length - 1), vars);
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
}
