from flask import Flask, render_template, request

app = Flask(__name__)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/plan_naps', methods=['POST'])
def plan_naps():
    date = request.form.get('date')
    num_naps = request.form.get('num_naps')
    # For now, just display the submitted data to confirm it works
    return f"Date received: {date}, Number of naps: {num_naps}"

if __name__ == '__main__':
    app.run(debug=True)
