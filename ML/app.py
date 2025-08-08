from flask import Flask, request, render_template, jsonify
import pandas as pd
import pickle
import os
import json
from datetime import datetime
from flask_cors import CORS
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

app = Flask(__name__)
CORS(app)

# Configure rate limiting with explicit in-memory storage
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["3 per hour"],
    storage_uri="memory://"
)

# Load model using pickle
try:
    with open('health_prediction_model.pkl', 'rb') as f:
        lifestyle_model = pickle.load(f)
except Exception as e:
    print(f"Error loading model: {e}")
    lifestyle_model = None

# Ensure static files are served if needed
app.static_folder = 'public'
app.static_url_path = '/public'

def validate_health_assessment(data):
    errors = []
    required_fields = ['age', 'gender', 'height', 'weight', 'education_level']
    
    for field in required_fields:
        if not data.get(field):
            errors.append({'field': field, 'message': f'{field.capitalize()} is required'})
        elif field == 'gender' and data[field] not in ['Male', 'Female', 'Other']:
            errors.append({'field': 'gender', 'message': 'Invalid gender value'})

    numeric_fields = [
        'age', 'height', 'weight', 'waist_size', 'blood_pressure', 'heart_rate',
        'cholesterol', 'glucose', 'insulin', 'sleep_hours', 'work_hours',
        'physical_activity', 'daily_steps', 'screen_time', 'calorie_intake',
        'sugar_intake', 'water_intake', 'meals_per_day', 'stress_level',
        'mental_health_score', 'income', 'environmental_risk_score', 'electrolyte_level'
    ]
    for field in numeric_fields:
        value = data.get(field)
        if value not in [None, '']:
            try:
                float(value)
            except (ValueError, TypeError):
                errors.append({'field': field, 'message': f'{field.capitalize()} must be a valid number'})

    return errors

def calculate_health_metrics(data):
    metrics = data.copy()
    if data.get('height') and data.get('weight'):
        try:
            height_m = float(data['height']) / 100
            bmi = float(data['weight']) / (height_m ** 2)
            metrics['bmi'] = round(bmi, 2)
            metrics['bmi_estimated'] = metrics['bmi']
            metrics['bmi_corrected'] = round(bmi * 0.995, 2)
            metrics['bmi_scaled'] = round(bmi * 3, 2)
        except (ValueError, TypeError):
            metrics['bmi'] = None
    metrics['insurance'] = 'Yes' if data.get('insurance') == 'Yes' else 'No'
    metrics['gene_marker_flag'] = int(data.get('gene_marker_flag', 0))
    metrics['submission_timestamp'] = datetime.now().isoformat()
    metrics['ip_address'] = request.remote_addr
    return metrics

def generate_health_report(data):
    recommendations = []
    if data.get('bmi'):
        if data['bmi'] < 18.5:
            recommendations.append('Consult a nutritionist for healthy weight gain')
        elif 25 <= data['bmi'] < 30:
            recommendations.append('Consider lifestyle modifications for weight management')
        elif data['bmi'] >= 30:
            recommendations.append('Consult a healthcare provider for weight management')
    return {
        'overall_risk_level': 'Pending model prediction',
        'recommendations': recommendations,
        'generated_at': datetime.now().isoformat()
    }

def save_assessment_data(data):
    os.makedirs('data', exist_ok=True)
    filename = f"data/health_assessment_{int(datetime.now().timestamp())}.json"
    with open(filename, 'w') as f:
        json.dump(data, f, indent=2)
    return filename

@app.route('/')
def home():
    return render_template('index.html', title='Health Assessment', message='Complete your comprehensive health assessment')

@app.route('/api/health-assessment', methods=['POST'])
@limiter.limit("3 per hour")
def health_assessment():
    data = request.json
    errors = validate_health_assessment(data)
    if errors:
        return jsonify({'success': False, 'message': 'Validation failed', 'errors': errors}), 400

    health_data = calculate_health_metrics(data)
    health_report = generate_health_report(health_data)
    
    try:
        if lifestyle_model is None:
            raise Exception("Model not loaded")
        df = pd.DataFrame([health_data])
        print("DataFrame columns:", df.columns.tolist())  # Debugging
        lifestyle_pred = lifestyle_model.predict(df)[0]
    except Exception as e:
        print(f"Prediction error: {e}")
        return jsonify({'success': False, 'message': f'Prediction failed: {str(e)}'}), 500
    
    health_report['overall_risk_level'] = str(lifestyle_pred)
    
    health_data['health_report'] = health_report
    filename = save_assessment_data(health_data)

    # Email sending removed

    return jsonify({
        'success': True,
        'message': 'Health assessment submitted successfully!',
        'data': {
            'risk_level': health_report['overall_risk_level'],
            'bmi': health_data.get('bmi'),
            'recommendations': health_report['recommendations'],
            'lifestyle_prediction': str(lifestyle_pred),
            'filename': filename,
            'timestamp': health_data['submission_timestamp']
        }
    })

@app.route('/api/stats', methods=['GET'])
def stats():
    try:
        files = [f for f in os.listdir('data') if f.startswith('health_assessment_')]
        total_assessments = 0
        risk_distribution = {'Low': 0, 'Moderate': 0, 'High': 0}
        avg_age = 0
        gender_distribution = {'Male': 0, 'Female': 0, 'Other': 0}

        for file in files:
            with open(f'data/{file}', 'r') as f:
                data = json.load(f)
                total_assessments += 1
                avg_age += float(data.get('age', 0))
                risk_level = data['health_report'].get('overall_risk_level', 'Low')
                if risk_level in risk_distribution:
                    risk_distribution[risk_level] += 1
                gender = data.get('gender')
                if gender in gender_distribution:
                    gender_distribution[gender] += 1

        avg_age = round(avg_age / total_assessments, 2) if total_assessments else 0
        return jsonify({
            'success': True,
            'stats': {
                'total_assessments': total_assessments,
                'average_age': avg_age,
                'risk_distribution': risk_distribution,
                'gender_distribution': gender_distribution,
                'last_updated': datetime.now().isoformat()
            }
        })
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True)
