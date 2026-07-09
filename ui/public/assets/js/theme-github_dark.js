define("ace/theme/github_dark-css",["require","exports","module"],function(require,exports,module){
module.exports=".ace-github-dark .ace_gutter{background:#161b22;color:#6e7681}.ace-github-dark .ace_print-margin{width:1px;background:#21262d}.ace-github-dark{background-color:#0d1117;color:#c9d1d9}.ace-github-dark .ace_cursor{color:#c9d1d9}.ace-github-dark .ace_marker-layer .ace_selection{background:#388bfd4d}.ace-github-dark.ace_multiselect .ace_selection.ace_start{box-shadow:0 0 3px 0 #0d1117}.ace-github-dark .ace_marker-layer .ace_step{background:#f2cc6033}.ace-github-dark .ace_marker-layer .ace_bracket{margin:-1px 0 0 -1px;border:1px solid #30363d}.ace-github-dark .ace_marker-layer .ace_active-line{background:#161b22}.ace-github-dark .ace_gutter-active-line{background-color:#161b22}.ace-github-dark .ace_marker-layer .ace_selected-word{border:1px solid #388bfd4d}.ace-github-dark .ace_invisible{color:#6e7681}.ace-github-dark .ace_keyword,.ace-github-dark .ace_meta,.ace-github-dark .ace_storage{color:#ff7b72}.ace-github-dark .ace_keyword.ace_operator{color:#c9d1d9}.ace-github-dark .ace_constant.ace_language{color:#79c0ff}.ace-github-dark .ace_constant.ace_numeric{color:#79c0ff}.ace-github-dark .ace_constant.ace_character,.ace-github-dark .ace_constant.ace_other{color:#79c0ff}.ace-github-dark .ace_fold{background-color:#d2a8ff;border-color:#c9d1d9}.ace-github-dark .ace_entity.ace_name.ace_function,.ace-github-dark .ace_support.ace_function{color:#d2a8ff}.ace-github-dark .ace_variable,.ace-github-dark .ace_variable.ace_language{color:#ffa657}.ace-github-dark .ace_support.ace_type,.ace-github-dark .ace_support.ace_class{color:#ffa657}.ace-github-dark .ace_entity.ace_name.ace_tag{color:#7ee787}.ace-github-dark .ace_entity.ace_other.ace_attribute-name{color:#79c0ff}.ace-github-dark .ace_string{color:#a5d6ff}.ace-github-dark .ace_string.ace_regexp{color:#56d364}.ace-github-dark .ace_comment{color:#8b949e;font-style:italic}.ace-github-dark .ace_heading{color:#7ee787;font-weight:700}.ace-github-dark .ace_list{color:#ff7b72}.ace-github-dark .ace_meta.ace_tag{color:#7ee787}.ace-github-dark .ace_indent-guide{background:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGBgYHj06NJ/AAk4A5fiKOBKAAAAAElFTkSuQmCC) right repeat-y}.ace-github-dark .ace_indent-guide-active{background:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAAAZSURBVHjaYvj///9/hivKyv8BAAAA//8DACLqBhbvk+/eAAAAAElFTkSuQmCC) right repeat-y}";
});
define("ace/theme/github_dark",["require","exports","module","ace/theme/github_dark-css","ace/lib/dom"],function(require,exports,module){
  "use strict";
  exports.isDark = true;
  exports.cssClass = "ace-github-dark";
  exports.cssText = require("./github_dark-css");
  var dom = require("../lib/dom");
  dom.importCssString(exports.cssText, exports.cssClass, false);
  exports.$id = "ace/theme/github_dark";
});
if (typeof window !== "undefined" && typeof window.require === "function") {
  window.require(["ace/theme/github_dark"],function(m){
    if(typeof module == "object" && typeof exports == "object" && module.exports) {
      module.exports = m;
    }
  });
}

