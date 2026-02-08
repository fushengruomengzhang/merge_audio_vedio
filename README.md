# MP4Box.js 合并音频到视频

该仓库提供一个简单的工具函数，用于在浏览器中用 **MP4Box.js** 将音频轨道合并进 MP4 视频。

## 使用方式

1. 引入 `mp4box.all.min.js`（可以使用 CDN 或本地文件）。
2. 调用 `mergeAudioIntoVideo(videoBuffer, audioBuffer)` 返回合并后的 `Blob`。

```js
import { mergeAudioIntoVideo } from "./app.js";

const videoBuffer = await fetch("/video.mp4").then((r) => r.arrayBuffer());
const audioBuffer = await fetch("/audio.m4a").then((r) => r.arrayBuffer());

const mergedBlob = await mergeAudioIntoVideo(videoBuffer, audioBuffer);
```

## 注意事项

- 建议使用时长一致的音视频文件，避免时间轴错位。
- 若页面提示 MP4Box.js 未加载，请检查脚本地址或网络连接。
- 若你需要更复杂的时间轴处理，可以在 `app.js` 中调整样本合并逻辑。
