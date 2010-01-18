/**
 * jQuery.pulse
 * Copyright (c) 2008 James Padolsey - jp(at)qd9(dot)co.uk | http://james.padolsey.com / http://enhance.qd-creative.co.uk
 * Dual licensed under MIT and GPL.
 * Date: 05/11/08
 *
 * @projectDescription Applies a continual pulse to any element specified
 * http://enhance.qd-creative.co.uk/demos/pulse/
 * Tested successfully with jQuery 1.2.6. On FF 2/3, IE 6/7, Opera 9.5 and Safari 3. on Windows XP.
 *
 * @author James Padolsey
 * @version 1.11
 * 
 * @id jQuery.pulse
 * @id jQuery.recover
 * @id jQuery.fn.pulse
 * @id jQuery.fn.recover
 */
(function($){
    $.fn.recover = function() {
        /* Empty inline styles - i.e. set element back to previous state */
        /* Note, the recovery might not work properly if you had inline styles set before pulse initiation */
        return this.each(function(){$(this).stop().css({backgroundColor:'',color:'',borderLeftColor:'',borderRightColor:'',borderTopColor:'',borderBottomColor:'',opacity:1});});
    }
    $.fn.pulse = function(options){
        var defaultOptions = {
            textColors: [],
            backgroundColors: [],
            borderColors: [],
            opacityPulse: true,
            opacityRange: [],
            speed: 1000,
            duration: false,
            runLength: false
        }, o = $.extend(defaultOptions,options);
        /* Validate custom options */
        if(o.textColors.length===1||o.backgroundColors.length===1||o.borderColors.length===1) {return false;}
        /* Begin: */
        return this.each(function(){
            var $t = $(this), pulseCount=1, pulseLimit = (o.runLength&&o.runLength>0) ? o.runLength*largestArrayLength([o.textColors.length,o.backgroundColors.length,o.borderColors.length,o.opacityRange.length]) : false;
            clearTimeout(recover);
            if(o.duration) {
                setTimeout(recover,o.duration);
            }
            function nudgePulse(textColorIndex,bgColorIndex,borderColorIndex,opacityIndex) {
                if(pulseLimit&&pulseCount===pulseLimit) {
                    return $t.recover();
                }
                pulseCount++;
                /* Initiate color change - on callback continue */
                return $t.animate(getColorsAtIndex(textColorIndex,bgColorIndex,borderColorIndex,opacityIndex),o.speed,function(){
                    /* Callback of each step */
                    nudgePulse(
                        getNextIndex(o.textColors,textColorIndex),
                        getNextIndex(o.backgroundColors,bgColorIndex),
                        getNextIndex(o.borderColors,borderColorIndex),
                        getNextIndex(o.opacityRange,opacityIndex)
                    );
                });
            }
            /* Set CSS to first step (no animation) */
            $t.css(getColorsAtIndex(0,0,0,0));
            /* Then animate to second step */
            nudgePulse(1,1,1,1);
            function getColorsAtIndex(textColorIndex,bgColorIndex,borderColorIndex,opacityIndex) {
                /* Prepare animation object - get's all property names/values from passed indexes */
                var params = {};
                if(o.backgroundColors.length) {
                    params['backgroundColor'] = o.backgroundColors[bgColorIndex];
                }
                if(o.textColors.length) {
                    params['color'] = o.textColors[textColorIndex];
                }
                if(o.borderColors.length) {
                    params['borderLeftColor'] = o.borderColors[borderColorIndex];
                    params['borderRightColor'] = o.borderColors[borderColorIndex];
                    params['borderTopColor'] = o.borderColors[borderColorIndex];
                    params['borderBottomColor'] = o.borderColors[borderColorIndex];
                }
                if(o.opacityPulse&&o.opacityRange.length) {
                    params['opacity'] = o.opacityRange[opacityIndex];
                }
                return params;
            }
            function getNextIndex(property,currentIndex) {
                if (property.length>currentIndex+1) {return currentIndex+1;}
                else {return 0;}
            }
            function largestArrayLength(arrayOfArrays) {
                return Math.max.apply( Math, arrayOfArrays ); 
            }
            function recover() {
                $t.recover();
            }
        });
    }
})(jQuery);
/* The below code extends the animate function so that it works with color animations */
/* By John Resig */
(function(jQuery){
jQuery.each(['backgroundColor','borderBottomColor','borderLeftColor','borderRightColor','borderTopColor','color','outlineColor'],function(i,attr){jQuery.fx.step[attr]=function(fx){if(fx.state==0){fx.start=getColor(fx.elem,attr);fx.end=getRGB(fx.end)}fx.elem.style[attr]="rgb("+[Math.max(Math.min(parseInt((fx.pos*(fx.end[0]-fx.start[0]))+fx.start[0]),255),0),Math.max(Math.min(parseInt((fx.pos*(fx.end[1]-fx.start[1]))+fx.start[1]),255),0),Math.max(Math.min(parseInt((fx.pos*(fx.end[2]-fx.start[2]))+fx.start[2]),255),0)].join(",")+")"}});
function getRGB(color){var result;if(color&&color.constructor==Array&&color.length==3)return color;if(result=/rgb\(\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*,\s*([0-9]{1,3})\s*\)/.exec(color)){return[parseInt(result[1]),parseInt(result[2]),parseInt(result[3])]}if(result=/rgb\(\s*([0-9]+(?:\.[0-9]+)?)\%\s*,\s*([0-9]+(?:\.[0-9]+)?)\%\s*,\s*([0-9]+(?:\.[0-9]+)?)\%\s*\)/.exec(color)){return[parseFloat(result[1])*2.55,parseFloat(result[2])*2.55,parseFloat(result[3])*2.55]}if(result=/#([a-fA-F0-9]{2})([a-fA-F0-9]{2})([a-fA-F0-9]{2})/.exec(color)){return[parseInt(result[1],16),parseInt(result[2],16),parseInt(result[3],16)]}if(result=/#([a-fA-F0-9])([a-fA-F0-9])([a-fA-F0-9])/.exec(color)){return[parseInt(result[1]+result[1],16),parseInt(result[2]+result[2],16),parseInt(result[3]+result[3],16)]}return colors[jQuery.trim(color).toLowerCase()]}
function getColor(elem,attr){var color;do{color=jQuery.curCSS(elem,attr);if(color!=''&&color!='transparent'||jQuery.nodeName(elem,"body")){break}attr="backgroundColor"}while(elem=elem.parentNode);return getRGB(color)};
var colors={aqua:[0,255,255],azure:[240,255,255],beige:[245,245,220],black:[0,0,0],blue:[0,0,255],brown:[165,42,42],cyan:[0,255,255],darkblue:[0,0,139],darkcyan:[0,139,139],darkgrey:[169,169,169],darkgreen:[0,100,0],darkkhaki:[189,183,107],darkmagenta:[139,0,139],darkolivegreen:[85,107,47],darkorange:[255,140,0],darkorchid:[153,50,204],darkred:[139,0,0],darksalmon:[233,150,122],darkviolet:[148,0,211],fuchsia:[255,0,255],gold:[255,215,0],green:[0,128,0],indigo:[75,0,130],khaki:[240,230,140],lightblue:[173,216,230],lightcyan:[224,255,255],lightgreen:[144,238,144],lightgrey:[211,211,211],lightpink:[255,182,193],lightyellow:[255,255,224],lime:[0,255,0],magenta:[255,0,255],maroon:[128,0,0],navy:[0,0,128],olive:[128,128,0],orange:[255,165,0],pink:[255,192,203],purple:[128,0,128],violet:[128,0,128],red:[255,0,0],silver:[192,192,192],white:[255,255,255],yellow:[255,255,0]};
})(jQuery);