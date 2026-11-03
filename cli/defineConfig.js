"use strict";
// Note: This file is also being used by the dev cli
Object.defineProperty(exports, "__esModule", { value: true });
exports.defineConfig = defineConfig;
exports.normalizeDevConfig = normalizeDevConfig;
var tslib_1 = require("tslib");
/**
 * Define a configuration file to run Moss in development mode with groups
 * and Tools pre-installed.
 *
 * @param config
 * @returns
 */
function defineConfig(config) {
    return config;
}
/**
 * Resolves the `tools`/`applets` spelling of a config file into the shape the
 * CLI consumes. A file that uses both spellings for the same list is rejected
 * rather than merged, because the two lists would almost certainly disagree.
 */
function normalizeDevConfig(input) {
    var pick = function (where, tools, applets) {
        var _a;
        if (tools && applets)
            throw new Error("Invalid Weave dev config: use either \"tools\" or \"applets\" ".concat(where, ", not both."));
        return (_a = tools !== null && tools !== void 0 ? tools : applets) !== null && _a !== void 0 ? _a : [];
    };
    var tools = input.tools, applets = input.applets, groups = input.groups, rest = tslib_1.__rest(input, ["tools", "applets", "groups"]);
    return tslib_1.__assign(tslib_1.__assign({}, rest), { applets: pick('at the top level', tools, applets), groups: (groups !== null && groups !== void 0 ? groups : []).map(function (group) {
            var tools = group.tools, applets = group.applets, groupRest = tslib_1.__rest(group, ["tools", "applets"]);
            return tslib_1.__assign(tslib_1.__assign({}, groupRest), { applets: pick("in group '".concat(group.name, "'"), tools, applets) });
        }) });
}
