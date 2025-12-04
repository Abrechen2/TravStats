# 🚀 Ollama Model-Optimierung für TravStats

Dieses Dokument beschreibt verschiedene Ansätze zur Optimierung der Email-Parsing-Genauigkeit mit Ollama.

## 📊 Vergleich der Optimierungsmethoden

| Methode | Aufwand | Genauigkeit | Geschwindigkeit | Kosten |
|---------|---------|-------------|-----------------|--------|
| **Prompt Engineering** | Niedrig | +20-30% | Gleich | Keine |
| **Besseres Model** | Mittel | +30-50% | Langsamer | Download |
| **Fine-Tuning** | Hoch | +50-80% | Gleich | Zeit + GPU |

---

## 1️⃣ Sofort: Enhanced Parser verwenden (✅ Empfohlen)

Die einfachste Verbesserung ist der enhanced Parser mit better prompts:

```bash
# In backend/.env
USE_LLM_PARSER=true
OLLAMA_MODEL=qwen2.5:7b  # Besseres Model für strukturierte Daten
```

### Aktivieren:

```typescript
// In backend/src/services/bookingParser.ts
// Ersetze den Import:
import { parseEmailWithLLM, isOllamaAvailable } from './llmParser.enhanced';
```

### Vorteile:
- ✅ Few-shot Learning (Beispiele im Prompt)
- ✅ Bessere JSON-Validierung
- ✅ IATA-Code-Cleaning
- ✅ Robustere Fehlerbehandlung

---

## 2️⃣ Bessere Standard-Models (Schnellste Verbesserung)

### Empfohlene Models (nach Genauigkeit):

#### 🥇 **qwen2.5:7b** (Beste Wahl für Struktur-Extraktion)
```bash
ollama pull qwen2.5:7b
```
**Specs:**
- Größe: 4.7GB
- RAM: 8GB
- Geschwindigkeit: 20-30 tokens/s (CPU)
- Genauigkeit: ★★★★★

**Pros:**
- Exzellent für strukturierte Datenextraktion
- Sehr gute JSON-Ausgabe
- Schnell

**Cons:**
- Größerer Download

#### 🥈 **mistral:7b** (Gut für Mehrsprachigkeit)
```bash
ollama pull mistral:7b
```
**Specs:**
- Größe: 4.1GB
- RAM: 8GB
- Geschwindigkeit: 15-25 tokens/s
- Genauigkeit: ★★★★☆

**Pros:**
- Sehr akkurat
- Gute Mehrsprachigkeit (DE/EN/FR)
- Zuverlässiges JSON

**Cons:**
- Etwas langsamer

#### 🥉 **llama3.2:3b** (Current - Baseline)
```bash
ollama pull llama3.2:3b
```
**Specs:**
- Größe: 2.0GB
- RAM: 4GB
- Geschwindigkeit: 30-50 tokens/s
- Genauigkeit: ★★★☆☆

**Pros:**
- Schnell
- Kleine Größe
- Gute Baseline

**Cons:**
- Weniger akkurat bei komplexen Emails

### Model wechseln:

```bash
# .env
OLLAMA_MODEL=qwen2.5:7b
```

---

## 3️⃣ Fine-Tuning (Beste Genauigkeit, hoher Aufwand)

### Was ist Fine-Tuning?

Fine-Tuning trainiert ein bestehendes Model speziell auf Flug-Emails, um die Genauigkeit massiv zu verbessern.

### Voraussetzungen:

- **GPU**: NVIDIA mit mindestens 12GB VRAM (z.B. RTX 3060)
- **Dataset**: Mindestens 50-100 Beispiel-Emails mit Labels
- **Zeit**: 2-4 Stunden Setup + Training
- **Tools**: Python, PyTorch, Hugging Face Transformers

### Schritt-für-Schritt Anleitung:

#### Schritt 1: Dataset erstellen

Erstelle ein JSON-Datei mit Trainingsbeispielen:

```json
[
  {
    "email": "Ihre Buchung 9RFAA7: München (MUC) nach Luxemburg (LUX) am 18.11.2025 um 11:00 mit Flug LH103. Rückflug am 20.11.2025 um 09:30 mit LH442. Sitzplatz: 26F. Preis: 513.47 EUR",
    "flights": [
      {
        "flightNumber": "LH103",
        "departureCode": "MUC",
        "arrivalCode": "LUX",
        "departureTime": "2025-11-18T11:00",
        "pnr": "9RFAA7",
        "seat": "26F",
        "price": "513.47",
        "currency": "EUR"
      },
      {
        "flightNumber": "LH442",
        "departureCode": "LUX",
        "arrivalCode": "MUC",
        "departureTime": "2025-11-20T09:30",
        "pnr": "9RFAA7"
      }
    ]
  },
  // ... 50-100 weitere Beispiele
]
```

**Tipp:** Sammle echte Emails von verschiedenen Airlines:
- Lufthansa, Ryanair, EasyJet, Eurowings
- Verschiedene Formate (HTML, Plain Text)
- Verschiedene Szenarien (One-way, Round-trip, Multi-leg)

#### Schritt 2: Fine-Tuning Setup

Erstelle ein Python-Skript für Fine-Tuning:

```python
# fine_tune.py
import json
from transformers import AutoTokenizer, AutoModelForCausalLM, Trainer, TrainingArguments
from datasets import Dataset
import torch

# 1. Load base model
model_name = "meta-llama/Llama-3.2-3B-Instruct"  # oder mistralai/Mistral-7B-Instruct-v0.2
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModelForCausalLM.from_pretrained(
    model_name,
    device_map="auto",
    torch_dtype=torch.float16
)

# 2. Load and prepare dataset
with open('flight_emails_dataset.json', 'r') as f:
    data = json.load(f)

def format_example(example):
    prompt = f"""Extract all flights from this email:

{example['email']}

Output JSON:"""

    completion = json.dumps(example['flights'])

    return {
        'text': f"{prompt}\n{completion}"
    }

dataset = Dataset.from_list([format_example(ex) for ex in data])

# 3. Tokenize
def tokenize_function(examples):
    return tokenizer(examples['text'], padding='max_length', truncation=True, max_length=512)

tokenized_dataset = dataset.map(tokenize_function, batched=True)

# 4. Training arguments
training_args = TrainingArguments(
    output_dir='./flight-parser-model',
    num_train_epochs=3,
    per_device_train_batch_size=4,
    gradient_accumulation_steps=4,
    learning_rate=2e-5,
    save_steps=50,
    logging_steps=10,
    warmup_steps=10,
    fp16=True,  # Mixed precision for faster training
)

# 5. Train
trainer = Trainer(
    model=model,
    args=training_args,
    train_dataset=tokenized_dataset,
)

trainer.train()

# 6. Save
model.save_pretrained('./flight-parser-model-final')
tokenizer.save_pretrained('./flight-parser-model-final')

print("✅ Fine-tuning complete!")
```

#### Schritt 3: Model zu Ollama exportieren

```bash
# Convert to GGUF format (für Ollama)
python convert_to_gguf.py ./flight-parser-model-final

# Create Modelfile
cat > Modelfile <<EOF
FROM ./flight-parser-model-final.gguf

PARAMETER temperature 0.05
PARAMETER top_p 0.9

SYSTEM """You are a specialized flight booking email parser. Extract flight information accurately."""
EOF

# Import to Ollama
ollama create flight-parser -f Modelfile

# Test
ollama run flight-parser "Extract flights from: Buchung MUC-LUX LH103 am 18.11.2025 11:00"
```

#### Schritt 4: In TravStats verwenden

```bash
# .env
USE_LLM_PARSER=true
OLLAMA_MODEL=flight-parser
```

### Erwartete Verbesserungen:

| Metrik | Vor Fine-Tuning | Nach Fine-Tuning |
|--------|-----------------|------------------|
| Genauigkeit | 70-80% | 90-95% |
| Flughafen-Codes | 75% | 98% |
| Mehrfach-Flüge | 60% | 95% |
| Preis-Extraktion | 50% | 85% |

---

## 4️⃣ Hybrid-Ansatz (✨ Beste Balance)

Kombiniere Regex + Enhanced LLM für beste Ergebnisse:

```typescript
// Backend logic (bereits implementiert in bookingParser.ts)
1. Regex-Parser läuft zuerst (schnell, deterministisch)
2. Wenn Regex < 80% Felder findet → LLM-Parser
3. Wenn LLM verfügbar → Beide vergleichen, besseres Ergebnis nehmen
```

### Vorteile:
- ✅ Fallback wenn Ollama nicht läuft
- ✅ Schnell für einfache Emails (Regex)
- ✅ Akkurat für komplexe Emails (LLM)
- ✅ Beste User Experience

---

## 🎯 Empfehlungen je nach Use-Case

### Für Hobby/Kleine Instanz:
```bash
OLLAMA_MODEL=llama3.2:3b  # Klein & schnell
```
✅ Enhanced Prompt verwenden

### Für Production (bis 100 User):
```bash
OLLAMA_MODEL=qwen2.5:7b  # Beste Balance
```
✅ Enhanced Prompt + Gutes Model

### Für Enterprise (100+ User):
```bash
OLLAMA_MODEL=flight-parser  # Fine-tuned
```
✅ Fine-Tuning investieren

---

## 📈 Performance Monitoring

Füge Metriken hinzu, um die Genauigkeit zu tracken:

```typescript
// backend/src/services/parserMetrics.ts
export interface ParserMetrics {
  timestamp: Date;
  parser: 'regex' | 'ollama';
  duration: number;
  fieldsExtracted: number;
  totalFields: number;
  accuracy: number;
}

export async function logParserMetrics(metrics: ParserMetrics) {
  // Save to database or log file
  await prisma.parserMetric.create({ data: metrics });
}
```

---

## 🔧 Troubleshooting

### Problem: "Ollama not available"
```bash
# Check if Ollama is running
curl http://localhost:11434/api/tags

# Start Ollama
ollama serve
```

### Problem: "Model too slow"
```bash
# Use smaller model
OLLAMA_MODEL=llama3.2:3b

# Or increase resources
docker-compose.yml:
  backend:
    cpus: '4'
    mem_limit: 8g
```

### Problem: "Bad extraction quality"
1. Check model: `ollama list`
2. Try enhanced parser with few-shot examples
3. Add more context to prompt
4. Consider fine-tuning

---

## 📚 Weitere Ressourcen

- [Ollama Documentation](https://github.com/ollama/ollama)
- [Llama Fine-Tuning Guide](https://huggingface.co/docs/transformers/training)
- [GGUF Conversion](https://github.com/ggerganov/llama.cpp)
- [Model Comparison](https://ollama.com/library)

---

## ✅ Quick Start Checklist

- [ ] Enhanced Parser aktivieren
- [ ] Besseres Model downloaden (`qwen2.5:7b`)
- [ ] `.env` konfigurieren
- [ ] Backend neu starten
- [ ] Test-Email importieren
- [ ] Genauigkeit vergleichen
- [ ] Bei Bedarf Fine-Tuning planen

---

**Fragen? Issues?** → https://github.com/your-repo/travstats/issues
