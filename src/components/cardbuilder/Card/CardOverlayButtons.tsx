import { LocationType } from '@jellyfin/sdk/lib/generated-client/models/location-type';
import React, { type FC } from 'react';
import ButtonGroup from '@mui/material/ButtonGroup';
import IconButton from '@mui/material/IconButton';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import CollectionsBookmarkIcon from '@mui/icons-material/CollectionsBookmark';
import classNames from 'classnames';

import { appRouter } from 'components/router/appRouter';
import globalize from 'lib/globalize';
import { getReadablePrimaryActionUi, isReadableItem } from 'utils/readableActionUi';
import { ItemAction } from 'constants/itemAction';
import { ItemKind } from 'types/base/models/item-kind';
import { ItemMediaKind } from 'types/base/models/item-media-kind';
import type { ItemDto } from 'types/base/models/item-dto';
import type { CardOptions } from 'types/cardOptions';

import PlayArrowIconButton from '../../common/PlayArrowIconButton';
import MoreVertIconButton from '../../common/MoreVertIconButton';

const getReadableMuiIcon = (iconName: string) => {
    switch (iconName) {
        case 'picture_as_pdf':
            return <PictureAsPdfIcon />;
        case 'auto_stories':
            return <AutoStoriesIcon />;
        case 'collections_bookmark':
            return <CollectionsBookmarkIcon />;
        default:
            return <MenuBookIcon />;
    }
};

const sholudShowOverlayPlayButton = (
    overlayPlayButton: boolean | undefined,
    item: ItemDto
) => {
    return (
        overlayPlayButton
        && !item.IsPlaceHolder
        && (item.LocationType !== LocationType.Virtual
            || !item.MediaType
            || item.Type === ItemKind.Program)
        && item.Type !== ItemKind.Person
    );
};

interface CardOverlayButtonsProps {
    item: ItemDto;
    cardOptions: CardOptions;
}

const CardOverlayButtons: FC<CardOverlayButtonsProps> = ({
    item,
    cardOptions
}) => {
    let overlayPlayButton = cardOptions.overlayPlayButton;

    if (
        overlayPlayButton == null
        && !cardOptions.overlayMoreButton
        && !cardOptions.overlayInfoButton
        && !cardOptions.cardLayout
    ) {
        overlayPlayButton = item.MediaType === ItemMediaKind.Video;
    }

    const url = appRouter.getRouteUrl(item, {
        parentId: cardOptions.parentId
    });

    const btnCssClass = classNames(
        'paper-icon-button-light',
        'cardOverlayButton',
        'itemAction'
    );

    const centerPlayButtonClass = classNames(
        btnCssClass,
        'cardOverlayButton-centered'
    );

    return (
        <a
            href={url}
            aria-label={item.Name || ''}
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                bottom: 0,
                right: 0,
                userSelect: 'none',
                borderRadius: '0.2em'
            }}
        >

            {cardOptions.centerPlayButton && (
                (() => {
                    const isReadable = isReadableItem(item);
                    const isResumable = !!(item.UserData && item.UserData.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0);
                    const readableUi = isReadable ? getReadablePrimaryActionUi(item, isResumable, globalize) : null;

                    if (readableUi) {
                        return (
                            <IconButton
                                className={centerPlayButtonClass}
                                data-action={ItemAction.Play}
                                title={readableUi.title}
                            >
                                {getReadableMuiIcon(readableUi.icon)}
                            </IconButton>
                        );
                    }

                    return (
                        <PlayArrowIconButton
                            className={centerPlayButtonClass}
                            action={ItemAction.Play}
                            title='Play'
                        />
                    );
                })()
            )}

            <ButtonGroup className='cardOverlayButton-br'>
                {sholudShowOverlayPlayButton(overlayPlayButton, item) && (
                    (() => {
                        const isReadable = isReadableItem(item);
                        const isResumable = !!(item.UserData && item.UserData.PlaybackPositionTicks && item.UserData.PlaybackPositionTicks > 0);
                        const readableUi = isReadable ? getReadablePrimaryActionUi(item, isResumable, globalize) : null;

                        if (readableUi) {
                            return (
                                <IconButton
                                    className={btnCssClass}
                                    data-action={ItemAction.Play}
                                    title={readableUi.title}
                                >
                                    {getReadableMuiIcon(readableUi.icon)}
                                </IconButton>
                            );
                        }

                        return (
                            <PlayArrowIconButton
                                className={btnCssClass}
                                action={ItemAction.Play}
                                title='Play'
                            />
                        );
                    })()
                )}

                {cardOptions.overlayMoreButton && (
                    <MoreVertIconButton
                        className={btnCssClass}
                    />
                )}
            </ButtonGroup>
        </a>
    );
};

export default CardOverlayButtons;
