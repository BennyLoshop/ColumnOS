window.parseVfsList = function parseVfsList(html) {
    const $ = xiyueta.load(html);
    const vfsList = [];

    $("*").each(function (i, obj) {
        console.log(i, $(obj).getLabelParamList());
        for (let item of $(obj).getLabelParamList()) {
            if (typeof item === "string" && item.slice(0, 4) === "vfs:") {
                vfsList.push($(obj).attr(item));
            }
        }
    });
    return [...new Set(vfsList)];
};


window.applyVfsList = function applyVfsList(html, blobMap) {
    const $ = xiyueta.load(html);
    const vfsList = [];
    $("*").each(function (i, obj) {
        console.log(i, $(obj).getLabelParamList());
        for (let item of $(obj).getLabelParamList()) {
            if (typeof item === "string" && item.slice(0, 4) === "vfs:") {
                $(obj).attr(item.slice(4), blobMap[$(obj).attr(item)]);
                $(obj).removeAttr(item);
            }
        }
    });
    return $.html();
}
