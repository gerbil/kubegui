define("ace/theme/idle_fingers-css",["require","exports","module"],function(require,exports,module){
module.exports=".ace-idle-fingers .ace_gutter{background:#3b3a32;color:#c6c6c6}.ace-idle-fingers .ace_print-margin{width:1px;background:#555451}.ace-idle-fingers{background-color:#323232;color:#dedede}.ace-idle-fingers .ace_cursor{color:#9f9f9f}.ace-idle-fingers .ace_marker-layer .ace_selection{background:#585656}.ace-idle-fingers.ace_multiselect .ace_selection.ace_start{box-shadow:0 0 3px 0 #323232}.ace-idle-fingers .ace_marker-layer .ace_step{background:#cc7700}.ace-idle-fingers .ace_marker-layer .ace_bracket{margin:-1px 0 0 -1px;border:1px solid #404040}.ace-idle-fingers .ace_marker-layer .ace_active-line{background:#353230}.ace-idle-fingers .ace_gutter-active-line{background-color:#353230}.ace-idle-fingers .ace_marker-layer .ace_selected-word{border:1px solid #585656}.ace-idle-fingers .ace_invisible{color:#404040}.ace-idle-fingers .ace_keyword,.ace-idle-fingers .ace_meta{color:#6c99bb}.ace-idle-fingers .ace_keyword.ace_operator{color:#cda869}.ace-idle-fingers .ace_constant.ace_language{color:#cf6a4c}.ace-idle-fingers .ace_constant.ace_numeric{color:#cf6a4c}.ace-idle-fingers .ace_constant.ace_character,.ace-idle-fingers .ace_constant.ace_other{color:#cf6a4c}.ace-idle-fingers .ace_fold{background-color:#cda869;border-color:#dedede}.ace-idle-fingers .ace_entity.ace_name.ace_function,.ace-idle-fingers .ace_support.ace_function{color:#9b703f}.ace-idle-fingers .ace_variable{color:#dedede}.ace-idle-fingers .ace_variable.ace_language{color:#6c99bb}.ace-idle-fingers .ace_support.ace_type,.ace-idle-fingers .ace_support.ace_class{color:#9b703f}.ace-idle-fingers .ace_entity.ace_name.ace_tag{color:#ac885b}.ace-idle-fingers .ace_entity.ace_other.ace_attribute-name{color:#cda869}.ace-idle-fingers .ace_string{color:#8f9d6a}.ace-idle-fingers .ace_string.ace_regexp{color:#e9c062}.ace-idle-fingers .ace_comment{color:#5f5a60;font-style:italic}.ace-idle-fingers .ace_heading{color:#cf6a4c;font-weight:bold}.ace-idle-fingers .ace_list{color:#cda869}.ace-idle-fingers .ace_meta.ace_tag{color:#ac885b}.ace-idle-fingers .ace_storage{color:#6c99bb}.ace-idle-fingers .ace_indent-guide{background:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGBg+P//fwMAChADfjPPqIAAAAAASUVORK5CYII=) right repeat-y}.ace-idle-fingers .ace_indent-guide-active{background:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAACXBIWXMAAAsTAAALEwEAmpwYAAAAIGNIUk0AAHolAACAgwAA+f8AAIDpAAB1MAAA6mAAADqYAAAXb5JfxUYAAAAZSURBVHjaYvj///9/hivKyv8BAAAA//8DACLqBhbvk+/eAAAAAElFTkSuQmCC) right repeat-y}";
});
define("ace/theme/idle_fingers",["require","exports","module","ace/theme/idle_fingers-css","ace/lib/dom"],function(require,exports,module){
  "use strict";
  exports.isDark = true;
  exports.cssClass = "ace-idle-fingers";
  exports.cssText = require("./idle_fingers-css");
  var dom = require("../lib/dom");
  dom.importCssString(exports.cssText, exports.cssClass, false);
  exports.$id = "ace/theme/idle_fingers";
});
if (typeof window !== "undefined" && typeof window.require === "function") {
  window.require(["ace/theme/idle_fingers"],function(m){
    if(typeof module == "object" && typeof exports == "object" && module.exports) {
      module.exports = m;
    }
  });
}

