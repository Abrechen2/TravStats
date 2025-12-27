import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { trainingApi, settingsApi } from '../lib/api';
import { logger } from '../lib/logger';
import NavigationBar from '../components/NavigationBar';
import TrainingDashboard from '../components/Training/TrainingDashboard';
import EmailAnnotation from '../components/Training/EmailAnnotation';
import BoardingPassAnnotation from '../components/Training/BoardingPassAnnotation';
import TrainingGuide from '../components/Training/TrainingGuide';
import InlineHelp from '../components/Help/InlineHelp';
import { useTranslation } from '../hooks/useTranslation';

export default function TrainingPage() {
  const { t } = useTranslation(['training', 'common']);
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'upload' | 'dashboard' | 'guide'>('upload');
  const [uploadedFile, setUploadedFile] = useState<{ id: string; type: string } | null>(null);
  const [developerModeEnabled, setDeveloperModeEnabled] = useState(false);
  const emailFileInputRef = useRef<HTMLInputElement>(null);
  const boardingPassFileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Check if developer mode is enabled
    settingsApi
      .getDeveloperMode()
      .then((data) => {
        setDeveloperModeEnabled(data.enabled);
        if (!data.enabled) {
          // Redirect to settings if not enabled
          navigate('/settings');
        }
      })
      .catch((error) => {
        logger.error('Failed to check developer mode:', error);
      });
  }, [navigate]);

  const handleFileUpload = async (file: File, type: 'email' | 'boarding_pass') => {
    try {
      const result = await trainingApi.upload(file, type);
      setUploadedFile({ id: result.id, type: result.type });
    } catch (error) {
      logger.error('Failed to upload file:', error);
      alert(t('training:errors.uploadFailed'));
    }
  };

  const handleAnnotationComplete = () => {
    setUploadedFile(null);
    setActiveTab('dashboard');
  };

  const handleCancel = () => {
    setUploadedFile(null);
  };

  const handleEditTrainingData = async (id: string, type: string) => {
    setUploadedFile({ id, type });
    setActiveTab('upload');
  };

  const handleEmailButtonClick = () => {
    emailFileInputRef.current?.click();
  };

  const handleBoardingPassButtonClick = () => {
    boardingPassFileInputRef.current?.click();
  };

  if (!developerModeEnabled) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">
            {t('training:developerModeNotEnabled')}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            {t('training:enableDeveloperMode')}
          </p>
          <Link to="/settings" className="btn-primary">
            {t('training:goToSettings')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <NavigationBar />
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('training:llmTraining')}</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t('training:trainLocalOllama')}
            </p>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('upload')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'upload'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {t('training:uploadAnnotation')}
            </button>
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'dashboard'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {t('training:dashboard')}
            </button>
            <button
              onClick={() => setActiveTab('guide')}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'guide'
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 dark:text-gray-400 dark:hover:text-gray-300'
              }`}
            >
              {t('training:guide')}
            </button>
          </nav>
        </div>

        {/* Content */}
        {activeTab === 'upload' && (
          <div className="space-y-6">
            <InlineHelp
              title={t('training:uploadAnnotation')}
              category="basic"
              content={
                <div className="space-y-2">
                  <p>
                    {t('training:uploadHelp.description')}
                  </p>
                  <ul className="list-disc list-inside space-y-1 ml-2">
                    <li>
                      <strong>{t('training:uploadHelp.emails.title')}</strong> {t('training:uploadHelp.emails.formats')}
                    </li>
                    <li>
                      <strong>{t('training:uploadHelp.boardingPasses.title')}</strong> {t('training:uploadHelp.boardingPasses.formats')}
                    </li>
                    <li>
                      <strong>{t('training:uploadHelp.annotation.title')}</strong> {t('training:uploadHelp.annotation.description')}
                    </li>
                    <li>
                      <strong>{t('training:uploadHelp.minimum.title')}</strong> {t('training:uploadHelp.minimum.description')}
                    </li>
                  </ul>
                </div>
              }
            />
            {!uploadedFile ? (
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
                <h2 className="text-xl font-semibold text-gray-900 dark:text-white mb-4">
                  {t('training:uploadFile')}
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <input
                      ref={emailFileInputRef}
                      type="file"
                      accept=".eml,.msg,.txt"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleFileUpload(file, 'email');
                        }
                      }}
                      className="hidden"
                    />
                    <button
                      onClick={handleEmailButtonClick}
                      className="w-full p-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-center"
                    >
                      <div className="text-4xl mb-2">📧</div>
                      <div className="font-semibold text-gray-900 dark:text-white">{t('training:email')}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {t('training:emailFormats')}
                      </div>
                    </button>
                  </div>
                  <div>
                    <input
                      ref={boardingPassFileInputRef}
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleFileUpload(file, 'boarding_pass');
                        }
                      }}
                      className="hidden"
                    />
                    <button
                      onClick={handleBoardingPassButtonClick}
                      className="w-full p-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg hover:border-blue-500 dark:hover:border-blue-400 transition-colors text-center"
                    >
                      <div className="text-4xl mb-2">🎫</div>
                      <div className="font-semibold text-gray-900 dark:text-white">{t('training:boardingPass')}</div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">
                        {t('training:boardingPassFormats')}
                      </div>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div>
                <div className="mb-4">
                  <button
                    onClick={handleCancel}
                    className="btn-secondary"
                  >
                    ← {t('common:buttons.cancel')}
                  </button>
                </div>
                {uploadedFile.type === 'email' ? (
                  <EmailAnnotation
                    trainingDataId={uploadedFile.id}
                    onComplete={handleAnnotationComplete}
                    onCancel={handleCancel}
                  />
                ) : (
                  <BoardingPassAnnotation
                    trainingDataId={uploadedFile.id}
                    onComplete={handleAnnotationComplete}
                    onCancel={handleCancel}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <TrainingDashboard onEditTrainingData={handleEditTrainingData} />
        )}

        {activeTab === 'guide' && <TrainingGuide />}
      </main>
    </div>
  );
}

