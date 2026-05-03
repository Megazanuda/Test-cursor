// 07. Пример сценария для режима Process Frame.
// Вызывается каждый кадр, поэтому:
//   - не используйте for/while/do...while;
//   - не читайте global.* слишком часто;
//   - храните промежуточные данные в local.* или var.
//
// Задача: плавно "качать" слой "Banner" по оси Y по синусоиде от времени композиции.

var main = thisComp;

if (main != null) {
    var banner = main.layer("Banner");
    if (banner != null) {
        // time - это время композиции в секундах (доступно в Process Frame).
        var baseX = 960.0;
        var baseY = 540.0;
        var amplitude = 30.0;
        var speed = 2.0;

        var offsetY = Math.sin(time * speed) * amplitude;

        banner.transform.position.setValue([baseX, baseY + offsetY, 0.0]);
    }
}
