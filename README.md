# merge_audio_vedio

## 下载 Twitter HLS 视频 (单文件)

```bash
node src/download-twitter-video.js "https://video.twimg.com/ext_tw_video/2019181308287807490/pu/pl/CkeCypAx89LKucYL.m3u8?variant_version=1&tag=12&v=cfc" output.mp4
```

脚本会先读取并解析 m3u8，再下载所有片段并合并为单一文件。如果是 fMP4，会先拼接 init segment 再输出 MP4；如果是 TS，则会输出 TS。
