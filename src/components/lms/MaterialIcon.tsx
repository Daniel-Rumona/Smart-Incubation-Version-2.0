import { FilePdfOutlined, FileTextOutlined, FileWordOutlined } from '@ant-design/icons'
import type { LessonMaterial } from '@/services/courseTemplatesService'

export const MaterialIcon = ({ kind }: { kind: LessonMaterial['kind'] }) => (
    <span className={`material-icon is-${kind}`}>
        {kind === 'pdf' ? <FilePdfOutlined /> : kind === 'docx' ? <FileWordOutlined /> : <FileTextOutlined />}
    </span>
)

export default MaterialIcon
