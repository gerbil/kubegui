define("ace/theme/solarized_dark-css",["require","exports","module"],function(require,exports,module){
module.exports=".ace-solarized-dark .ace_gutter{background:#073642;color:#586e75}.ace-solarized-dark .ace_print-margin{width:1px;background:#073642}.ace-solarized-dark{background-color:#002b36;color:#839496}.ace-solarized-dark .ace_cursor{color:#819090}.ace-solarized-dark .ace_marker-layer .ace_selection{background:#073642}.ace-solarized-dark.ace_multiselect .ace_selection.ace_start{box-shadow:0 0 3px 0px #002b36}.ace-solarized-dark .ace_marker-layer .ace_step{background:rgb(102,82,0)}.ace-solarized-dark .ace_marker-layer .ace_bracket{margin:-1px 0 0 -1px;border:1px solid rgba(147,161,161,0.5)}.ace-solarized-dark .ace_marker-layer .ace_active-line{background:#073642}.ace-solarized-dark .ace_gutter-active-line{background-color:#073642}.ace-solarized-dark .ace_marker-layer .ace_selected-word{border:1px solid #073642}.ace-solarized-dark .ace_invisible{color:rgba(147,161,161,0.5)}.ace-solarized-dark .ace_keyword,.ace-solarized-dark .ace_meta,.ace-solarized-dark .ace_support.ace_class,.ace-solarized-dark .ace_support.ace_type{color:#859900}.ace-solarized-dark .ace_constant.ace_character,.ace-solarized-dark .ace_constant.ace_other{color:#CB4B16}.ace-solarized-dark .ace_constant.ace_language{color:#B58900}.ace-solarized-dark .ace_constant.ace_numeric{color:#D33682}.ace-solarized-dark .ace_fold{background-color:#268BD2;border-color:#839496}.ace-solarized-dark .ace_entity.ace_name.ace_function,.ace-solarized-dark .ace_entity.ace_name.ace_tag,.ace-solarized-dark .ace_support.ace_function,.ace-solarized-dark .ace_variable,.ace-solarized-dark .ace_variable.ace_language{color:#268BD2}.ace-solarized-dark .ace_storage{color:#93A1A1}.ace-solarized-dark .ace_string{color:#2AA198}.ace-solarized-dark .ace_string.ace_regexp{color:#DC322F}.ace-solarized-dark .ace_comment,.ace-solarized-dark .ace_entity.ace_other.ace_attribute-name{color:#586E75}.ace-solarized-dark .ace_indent-guide{background:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAACCAYAAACZgbYnAAAAEklEQVQImWNgYGBgYHj06NJ/AAk4A5fiKOBKAAAAAElFTkSuQmCC) right repeat-y}";
});

define("ace/theme/solarized_dark",["require","exports","module","ace/theme/solarized_dark-css","ace/lib/dom"],function(require,exports,module){
  exports.isDark=true;
  exports.cssClass="ace-solarized-dark";
  exports.cssText=require("./solarized_dark-css");
  var dom=require("../lib/dom");
  dom.importCssString(exports.cssText,exports.cssClass,false);
});
(function(){
  window.require(["ace/theme/solarized_dark"],function(m){
    if(typeof module=="object"&&typeof exports=="object"&&module){module.exports=m;}
  });
})();

