import sys, os
from faster_whisper import WhisperModel

sys.stdout.reconfigure(encoding='utf-8')

model = WhisperModel('tiny', device='cpu', compute_type='int8')
segments, _ = model.transcribe(sys.argv[1], language='ru')
text = ''.join(seg.text for seg in segments)
sys.stdout.write(text + '\n')
