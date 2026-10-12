import React from 'react'

const InfoBox: React.FC<InfoBoxProps> = ({ info, description, prominent = false }) => {
  return (
    <div className="focus-stat-cell" data-emphasis={prominent ? 'primary' : undefined}>
      <span className="focus-stat-value">{info}</span>
      <span className="focus-stat-label">{description}</span>
    </div>
  )
}

export default React.memo(InfoBox)

export type InfoBoxProps = {
  info: string
  description: string
  prominent?: boolean
}
