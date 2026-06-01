import sys, json, whisper, os, platform

sys.stdout.reconfigure(encoding='utf-8')

if platform.system() == 'Windows':
    os.environ['PATH'] += r';C:\Program Files\KMPlayer 64X\LAVFilters64'

model = whisper.load_model('tiny')
result = model.transcribe(sys.argv[1], language='ru', task='transcribe')
sys.stdout.write(result['text'] + '\n')
